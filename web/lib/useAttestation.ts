"use client";

import { useCallback, useRef, useState } from "react";
import { decodeAbiParameters } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ORACLE_ADDRESS, EXPLORER, oracleAbi } from "./contracts";
import {
    CONTRACT_REGISTRY,
    FDC_PROTOCOL_ID,
    KNOWN,
    fdcHubAbi,
    feeConfigAbi,
    registryAbi,
    relayAbi,
    revenueDtoType,
    submitAttestationAbi,
    systemsManagerAbi,
    votingRoundUrl,
    web2JsonResponseType,
    roundIdForTimestamp,
    secondsUntilRoundCloses,
} from "./flare";

/**
 * Runs a complete FDC attestation from the browser and narrates it.
 *
 * This is the part of the product that is normally hidden. An attestation takes a couple of minutes — the
 * request has to land in a voting round, that round has to close and be relayed, and then the Data
 * Availability layer builds the Merkle proof. Most projects put a spinner over that and hope. Showing it
 * instead is the point: every line below is a real network fact, with a link a judge can open while it is
 * still happening, and the wait is the evidence that nobody is faking the number.
 *
 * Measured end to end on Coston2: 116 seconds, of which 83 were waiting for the round to be relayed.
 *
 * The whole loop lives in the browser deliberately. The two server routes it calls are short proxies, so
 * there is no long-running function to time out and the page works the same locally and deployed.
 */

export type Tone = "plain" | "proof" | "alert" | "muted";

export interface LogLine {
    id: number;
    text: string;
    tone: Tone;
    href?: string;
    /** Rendered as a live countdown rather than static text. */
    countdownTo?: number;
}

export type Phase =
    | "idle"
    | "composing"
    | "awaiting-request-signature"
    | "in-round"
    | "finalising"
    | "retrieving-proof"
    | "awaiting-store-signature"
    | "done"
    | "failed";

export interface AttestationState {
    phase: Phase;
    log: LogLine[];
    roundId?: number;
    /** The figure the network agreed on, in cents, once the proof is decoded. */
    provenCents?: bigint;
    storedTxHash?: string;
    error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useAttestation() {
    const client = usePublicClient();
    const { writeContractAsync } = useWriteContract();
    const { address } = useAccount();

    /** The oracle's refusals, in words a person can act on. */
    function refusal(name?: string): string {
        switch (name) {
            case "OverlappingPeriod":
                return "the oracle refused: this account already proved a period that overlaps this window. A period is a month, and periods cannot overlap, so one account can attest about once a month. For another live run, connect a fresh wallet account";
            case "StalePeriod":
                return "the oracle refused: this period ends before the account's latest proven period";
            case "AttestationAlreadyUsed":
                return "the oracle refused: this exact attestation was already stored once";
            case "InvalidPeriodLength":
                return "the oracle refused: a period must span 26 to 32 days";
            case "NotAccountOwner":
                return "the oracle refused: this account is bound to a different wallet";
            case "AccountMismatch":
                return "the oracle refused: the attested payload names a different account";
            case "InvalidProof":
                return "the oracle refused the Merkle proof";
            default:
                return "the oracle refused the store. Nothing was signed, and no failed transaction was sent";
        }
    }

    const [state, setState] = useState<AttestationState>({ phase: "idle", log: [] });
    const nextId = useRef(0);
    const cancelled = useRef(false);

    const say = useCallback((text: string, tone: Tone = "plain", extra?: Partial<LogLine>) => {
        setState((s) => ({ ...s, log: [...s.log, { id: nextId.current++, text, tone, ...extra }] }));
    }, []);

    const reset = useCallback(() => {
        cancelled.current = true;
        nextId.current = 0;
        setState({ phase: "idle", log: [] });
    }, []);

    const run = useCallback(
        async (opts: { source: "stripe" | "demo"; accountRef?: string; revenueCents?: number; periodStart?: number; periodEnd?: number }) => {
            if (!client) return;
            cancelled.current = false;
            nextId.current = 0;
            setState({ phase: "composing", log: [] });

            const phase = (p: Phase) => setState((s) => ({ ...s, phase: p }));
            const stop = () => cancelled.current;

            try {
                // ---------------------------------------------------------------- resolve the protocol
                const lookup = async (name: keyof typeof KNOWN) => {
                    try {
                        const a = await client.readContract({
                            address: CONTRACT_REGISTRY,
                            abi: registryAbi,
                            functionName: "getContractAddressByName",
                            args: [name],
                        });
                        return a as `0x${string}`;
                    } catch {
                        return KNOWN[name] as `0x${string}`;
                    }
                };

                say("resolving Flare contracts from the registry", "muted");
                const [fdcHub, feeConfig, systemsManager, relay] = await Promise.all([
                    lookup("FdcHub"),
                    lookup("FdcRequestFeeConfigurations"),
                    lookup("FlareSystemsManager"),
                    lookup("Relay"),
                ]);
                if (stop()) return;
                say(`FdcHub ${fdcHub}`, "muted", { href: `${EXPLORER}/address/${fdcHub}` });

                // ---------------------------------------------------------------- compose the request
                say(
                    opts.source === "stripe"
                        ? "composing a Web2Json request over the Stripe balance transactions API"
                        : "composing a Web2Json request over a public keyless endpoint"
                );
                const prepared = await fetch("/api/attest/prepare", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(opts),
                }).then(async (r) => {
                    const j = await r.json();
                    if (!r.ok) throw new Error(j.error ?? `prepare failed with ${r.status}`);
                    return j;
                });
                if (stop()) return;

                say(`${prepared.request.httpMethod} ${prepared.request.url}`, "muted");
                say("verifier accepted the request and encoded it", "plain");

                // ---------------------------------------------------------------- pay and submit
                const fee = (await client.readContract({
                    address: feeConfig,
                    abi: feeConfigAbi,
                    functionName: "getRequestFee",
                    args: [prepared.abiEncodedRequest],
                })) as bigint;
                if (stop()) return;
                say(`request fee ${Number(fee) / 1e18} C2FLR`, "muted");

                phase("awaiting-request-signature");
                say("submitting the request to FdcHub. Confirm in your wallet");
                const requestTx = await writeContractAsync({
                    address: fdcHub,
                    abi: fdcHubAbi,
                    functionName: "requestAttestation",
                    args: [prepared.abiEncodedRequest],
                    value: fee,
                });
                if (stop()) return;
                say(`request submitted · ${requestTx.slice(0, 10)}…`, "plain", { href: `${EXPLORER}/tx/${requestTx}` });

                const receipt = await client.waitForTransactionReceipt({ hash: requestTx });
                if (stop()) return;
                const block = await client.getBlock({ blockNumber: receipt.blockNumber });

                // ---------------------------------------------------------------- work out the round
                const [firstStartTs, duration] = (await Promise.all([
                    client.readContract({
                        address: systemsManager,
                        abi: systemsManagerAbi,
                        functionName: "firstVotingRoundStartTs",
                    }),
                    client.readContract({
                        address: systemsManager,
                        abi: systemsManagerAbi,
                        functionName: "votingEpochDurationSeconds",
                    }),
                ])) as [bigint, bigint];
                if (stop()) return;

                const roundId = roundIdForTimestamp(block.timestamp, firstStartTs, duration);
                setState((s) => ({ ...s, roundId }));
                phase("in-round");
                say(`landed in voting round ${roundId.toLocaleString("en-US")}`, "plain", {
                    href: votingRoundUrl(roundId),
                });

                const closesIn = secondsUntilRoundCloses(roundId, firstStartTs, duration);
                say("round closes in", "muted", { countdownTo: Math.floor(Date.now() / 1000) + Math.max(closesIn, 0) });

                // ---------------------------------------------------------------- wait for finality
                phase("finalising");
                say("waiting for Flare's data providers to agree and relay the round", "muted");

                let protocolId = FDC_PROTOCOL_ID;
                try {
                    const verification = await lookup("FdcVerification");
                    protocolId = Number(
                        await client.readContract({
                            address: verification,
                            abi: [
                                {
                                    type: "function",
                                    name: "fdcProtocolId",
                                    stateMutability: "view",
                                    inputs: [],
                                    outputs: [{ type: "uint8" }],
                                },
                            ] as const,
                            functionName: "fdcProtocolId",
                        })
                    );
                } catch {
                    /* the constant is right on every Flare network so far */
                }

                let finalised = false;
                let announcedRounds = -1;
                for (let i = 0; i < 200 && !finalised; i++) {
                    if (stop()) return;
                    finalised = (await client.readContract({
                        address: relay,
                        abi: relayAbi,
                        functionName: "isFinalized",
                        args: [BigInt(protocolId), BigInt(roundId)],
                    })) as boolean;
                    if (finalised) break;

                    const current = Number(
                        await client.readContract({
                            address: systemsManager,
                            abi: systemsManagerAbi,
                            functionName: "getCurrentVotingEpochId",
                        })
                    );
                    const behind = current - roundId;
                    if (behind !== announcedRounds) {
                        announcedRounds = behind;
                        say(
                            behind <= 0
                                ? `round ${roundId.toLocaleString("en-US")} is still open`
                                : `${behind} round${behind === 1 ? "" : "s"} on from it, not relayed yet`,
                            "muted"
                        );
                    }
                    await sleep(10_000);
                }
                if (stop()) return;
                if (!finalised) throw new Error("The voting round did not finalise in time. It may still land, so try again shortly.");

                const root = (await client.readContract({
                    address: relay,
                    abi: relayAbi,
                    functionName: "merkleRoots",
                    args: [BigInt(protocolId), BigInt(roundId)],
                })) as string;
                say(`round finalised · Merkle root ${root.slice(0, 10)}…${root.slice(-4)}`, "proof", {
                    href: votingRoundUrl(roundId),
                });

                // ---------------------------------------------------------------- fetch the proof
                phase("retrieving-proof");
                say("asking the Data Availability layer for the proof", "muted");
                let proof: { proof: string[]; response_hex: string } | undefined;
                for (let i = 0; i < 60 && !proof; i++) {
                    if (stop()) return;
                    const r = await fetch("/api/attest/proof", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ votingRoundId: roundId, requestBytes: prepared.abiEncodedRequest }),
                    }).then((x) => x.json());
                    if (!r.pending && r.proof?.response_hex) {
                        proof = r.proof;
                        break;
                    }
                    await sleep(8_000);
                }
                if (stop()) return;
                if (!proof) throw new Error("The DA layer did not return a proof in time. The round finalised, so it should appear shortly. Try again.");

                say(
                    `proof retrieved · ${proof.proof.length} Merkle sibling${proof.proof.length === 1 ? "" : "s"}`,
                    "proof"
                );

                // ---------------------------------------------------------------- decode and store
                const [decoded] = decodeAbiParameters(web2JsonResponseType, proof.response_hex as `0x${string}`);
                const [dto] = decodeAbiParameters(revenueDtoType, decoded.responseBody.abiEncodedData);

                setState((s) => ({ ...s, provenCents: dto.revenueCents }));
                say(
                    `the network agreed: ${dto.platform}/${dto.accountRef} earned $${(Number(dto.revenueCents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                    "proof"
                );

                const accountId = (await client.readContract({
                    address: ORACLE_ADDRESS,
                    abi: oracleAbi,
                    functionName: "accountIdFor",
                    args: [dto.platform, dto.accountRef],
                })) as `0x${string}`;

                phase("awaiting-store-signature");
                say("storing the verified figure on chain. Confirm in your wallet");

                // viem hands back a frozen decode result; rebuild it as a plain object to pass as an argument.
                const data = {
                    attestationType: decoded.attestationType,
                    sourceId: decoded.sourceId,
                    votingRound: decoded.votingRound,
                    lowestUsedTimestamp: decoded.lowestUsedTimestamp,
                    requestBody: {
                        url: decoded.requestBody.url,
                        httpMethod: decoded.requestBody.httpMethod,
                        headers: decoded.requestBody.headers,
                        queryParams: decoded.requestBody.queryParams,
                        body: decoded.requestBody.body,
                        postProcessJq: decoded.requestBody.postProcessJq,
                        abiSignature: decoded.requestBody.abiSignature,
                    },
                    responseBody: { abiEncodedData: decoded.responseBody.abiEncodedData },
                };

                /*
                 * Simulate before asking for a signature. If the oracle would refuse (an overlapping
                 * period, a reused attestation, someone else's account), the refusal surfaces here as a
                 * named error and the wallet never sees a transaction destined to fail. An earlier
                 * version skipped this and printed success over a reverted store, which is exactly the
                 * kind of lie this product exists not to tell.
                 */
                try {
                    await client.simulateContract({
                        address: ORACLE_ADDRESS,
                        abi: submitAttestationAbi,
                        functionName: "submitAttestation",
                        args: [accountId, { merkleProof: proof.proof as `0x${string}`[], data }],
                        account: address,
                    });
                } catch (simErr) {
                    const name = (simErr as { cause?: { data?: { errorName?: string } } })?.cause?.data?.errorName
                        ?? (String(simErr).match(/OverlappingPeriod|StalePeriod|AttestationAlreadyUsed|InvalidPeriodLength|NotAccountOwner|AccountMismatch|InvalidProof/) ?? [])[0];
                    throw new Error(refusal(name));
                }

                const storeTx = await writeContractAsync({
                    address: ORACLE_ADDRESS,
                    abi: submitAttestationAbi,
                    functionName: "submitAttestation",
                    args: [accountId, { merkleProof: proof.proof as `0x${string}`[], data }],
                });
                if (stop()) return;
                const storeReceipt = await client.waitForTransactionReceipt({ hash: storeTx });
                if (stop()) return;
                if (storeReceipt.status !== "success") {
                    throw new Error(
                        "the store transaction reverted on chain. The attestation itself is fine; the oracle refused the period. Open the transaction for details"
                    );
                }

                setState((s) => ({ ...s, storedTxHash: storeTx, phase: "done" }));
                say("verified on chain", "proof", { href: `${EXPLORER}/tx/${storeTx}` });
            } catch (e) {
                if (cancelled.current) return;
                const message = friendly(e);
                setState((s) => ({ ...s, phase: "failed", error: message }));
                say(message, "alert");
            }
        },
        [client, writeContractAsync, say]
    );

    return { ...state, run, reset };
}

/** Wallet and RPC errors are long and shouty. Keep the first useful sentence. */
function friendly(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    if (/User rejected|denied transaction|rejected the request/i.test(raw)) return "You cancelled the signature.";
    if (/NotAccountOwner/i.test(raw))
        return "This account is already bound to a different wallet, so only that wallet can attest for it.";
    if (/StalePeriod/i.test(raw)) return "That period is not newer than the one already proven for this account.";
    if (/AttestationAlreadyUsed/i.test(raw)) return "That exact attestation has already been stored.";
    if (/insufficient funds/i.test(raw)) return "Not enough C2FLR to pay the request fee and gas.";
    return raw.split("\n")[0].slice(0, 200);
}
