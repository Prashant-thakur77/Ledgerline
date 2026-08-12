/**
 * Prove a period of revenue on chain.
 *
 *   yarn hardhat run scripts/ledgerline/attest-revenue.ts --network coston2
 *
 * Composes a Web2Json attestation over a revenue API, waits for the voting round to finalise, fetches the
 * Merkle proof and hands it to RevenueOracle. Configure with env vars:
 *   ORACLE_ADDRESS   deployed RevenueOracle (defaults to the address in docs/DEPLOYED.md)
 *   REVENUE_SOURCE   "demo" (default, keyless) or "stripe"
 *   STRIPE_API_KEY   restricted read-only key, required when REVENUE_SOURCE=stripe
 *   ACCOUNT_REF      the platform's account identifier
 *   PERIOD_START / PERIOD_END   unix seconds
 *   DEMO_REVENUE_CENTS          the figure the demo source should attest
 */
import { ethers } from "hardhat";
import { prepareAttestationRequestBase, submitAttestationRequest, retrieveDataAndProofBaseWithRetry } from "../utils/fdc";
import {
    REVENUE_ABI_SIGNATURE,
    demoSource,
    stripeSource,
    stripeBalanceSource,
    SourceConfig,
    Window,
} from "./revenue-sources";

const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS ?? "0x151FDDB3d60B1Cc9AD43e0831495D430b0412906";

const MONTH = 30 * 24 * 60 * 60;

function buildWindow(): Window {
    const periodEnd = Number(process.env.PERIOD_END ?? Math.floor(Date.now() / 1000));
    const periodStart = Number(process.env.PERIOD_START ?? periodEnd - MONTH);
    return {
        accountRef: process.env.ACCOUNT_REF ?? "acct_1LedgerlineDemo",
        periodStart,
        periodEnd,
    };
}

function buildSource(w: Window): SourceConfig {
    const which = (process.env.REVENUE_SOURCE ?? "demo").toLowerCase();
    if (which === "stripe" || which === "stripe-payouts") {
        const key = process.env.STRIPE_API_KEY;
        if (!key) throw new Error(`REVENUE_SOURCE=${which} needs STRIPE_API_KEY (a read-only restricted key)`);
        return which === "stripe" ? stripeBalanceSource(w, key) : stripeSource(w, key);
    }
    return demoSource(w, Number(process.env.DEMO_REVENUE_CENTS ?? 400_000));
}

async function prepareRequest(source: SourceConfig) {
    const url = `${VERIFIER_URL_TESTNET}/verifier/web2/Web2Json/prepareRequest`;
    const data = await prepareAttestationRequestBase(url, VERIFIER_API_KEY_TESTNET!, "Web2Json", "PublicWeb2", {
        url: source.url,
        httpMethod: source.httpMethod,
        headers: source.headers,
        queryParams: source.queryParams,
        body: source.body,
        postProcessJq: source.postProcessJq,
        abiSignature: REVENUE_ABI_SIGNATURE,
    });
    if (data.status !== "VALID") {
        throw new Error(`Verifier rejected the request: ${JSON.stringify(data)}`);
    }
    return data.abiEncodedRequest as string;
}

async function main() {
    const w = buildWindow();
    const source = buildSource(w);

    console.log("Source     :", source.platform, "-", source.url);
    console.log("Account    :", w.accountRef);
    console.log("Period     :", new Date(w.periodStart * 1000).toISOString(), "->", new Date(w.periodEnd * 1000).toISOString());
    console.log("jq         :", source.postProcessJq, "\n");

    const abiEncodedRequest = await prepareRequest(source);

    console.log("Submitting attestation request...");
    const roundId = await submitAttestationRequest(abiEncodedRequest);
    console.log(`Voting round ${roundId}. Waiting for it to finalise — this takes a couple of minutes.\n`);

    const proof = await retrieveDataAndProofBaseWithRetry(
        `${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`,
        abiEncodedRequest,
        roundId
    );
    console.log("\nProof retrieved.");

    const oracle = await ethers.getContractAt("RevenueOracle", ORACLE_ADDRESS);

    // Decode the attested response with the same type the contract will use.
    const responseType =
        "tuple(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
        "tuple(string url,string httpMethod,string headers,string queryParams,string body,string postProcessJq,string abiSignature) requestBody," +
        "tuple(bytes abiEncodedData) responseBody)";
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([responseType], proof.response_hex)[0];

    const dto = ethers.AbiCoder.defaultAbiCoder().decode(
        ["tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd)"],
        decoded.responseBody.abiEncodedData
    )[0];
    console.log(`\nAttested: ${dto.platform}/${dto.accountRef} earned ${Number(dto.revenueCents) / 100} USD`);

    const accountId = await oracle.accountIdFor(dto.platform, dto.accountRef);
    console.log("accountId:", accountId);

    // ethers returns a frozen Result from decode() and refuses to re-encode it as an argument,
    // so rebuild it as a plain object.
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

    const tx = await oracle.submitAttestation(accountId, { merkleProof: [...proof.proof], data });
    const receipt = await tx.wait();
    console.log("\nStored on chain. tx:", receipt.hash);
    console.log("Explorer:", `https://coston2-explorer.flare.network/tx/${receipt.hash}`);

    const latest = await oracle.latestRevenue(accountId);
    console.log(`Latest proven revenue: $${Number(latest.revenueCents) / 100} for the period ending ${new Date(Number(latest.periodEnd) * 1000).toISOString()}`);
}

void main().then(() => process.exit(0));
