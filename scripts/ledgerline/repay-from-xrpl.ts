import { ethers } from "hardhat";
import { Client, Wallet, xrpToDrops } from "xrpl";
import { prepareAttestationRequestBase, submitAttestationRequest, retrieveDataAndProofBaseWithRetry } from "../utils/fdc";

/**
 * Repay an advance with real XRP, from the XRP Ledger.
 *
 * This is the return leg of `advance-to-xrpl.ts`, and it closes the loop: the borrower was funded in real
 * XRP on the XRP Ledger, and repays in real XRP on the XRP Ledger. The obligation itself never leaves Flare
 * and stays denominated in dollars.
 *
 * Three steps, in order:
 *   1. Send an ordinary XRPL Payment to the contract's XRPL treasury, carrying the accountId as the
 *      transaction's InvoiceID — which is what FDC reports as the standard payment reference.
 *   2. Ask FDC to attest that payment. This is a *Payment* attestation, not Web2Json: a second attestation
 *      type, verified by the same Merkle machinery.
 *   3. Hand the proof to AdvanceManager, which checks the chain, the recipient, the reference and the
 *      proof itself before reducing the debt.
 *
 *   XRPL_SECRET=s… npx hardhat run scripts/ledgerline/repay-from-xrpl.ts --network coston2
 *
 * Env:
 *   XRPL_SECRET     the borrower's XRPL seed (the account that received the advance)
 *   XRP_AMOUNT      how much XRP to repay (default 5)
 *   MANAGER_ADDRESS deployed AdvanceManager
 *   PLATFORM / ACCOUNT_REF   which account is being repaid
 */

const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

const MANAGER_ADDRESS = process.env.MANAGER_ADDRESS ?? "0x4EC83Eb966dcac3e4291c85320Cfd6941a7C4f66";
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS ?? "0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6";
const PLATFORM = process.env.PLATFORM ?? "stripe";
const ACCOUNT_REF = process.env.ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";
const XRP_AMOUNT = process.env.XRP_AMOUNT ?? "5";
const XRPL_RPC = process.env.XRPL_RPC ?? "wss://s.altnet.rippletest.net:51233";

/** Right-pad a short ASCII string into the bytes32 FDC uses for attestation type and source id. */
function toUtf8HexString(data: string) {
    let hex = "";
    for (let i = 0; i < data.length; i++) hex += data.charCodeAt(i).toString(16).padStart(2, "0");
    return "0x" + hex.padEnd(64, "0");
}

async function prepareRequest(transactionId: string) {
    const url = `${VERIFIER_URL_TESTNET}/verifier/xrp/Payment/prepareRequest`;
    const data = await prepareAttestationRequestBase(url, VERIFIER_API_KEY_TESTNET!, "Payment", "testXRP", {
        transactionId,
        inUtxo: "0",
        utxo: "0",
    });
    if (data.status !== "VALID") {
        throw new Error(`Verifier rejected the Payment request: ${JSON.stringify(data)}`);
    }
    return data.abiEncodedRequest as string;
}

async function main() {
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER_ADDRESS);
    const oracle = await ethers.getContractAt("RevenueOracle", ORACLE_ADDRESS);

    const accountId = await oracle.accountIdFor(PLATFORM, ACCOUNT_REF);
    const treasuryAddress = await manager.xrplTreasuryAddress();
    if (!treasuryAddress) {
        throw new Error("No XRPL treasury configured on AdvanceManager — call setXrplTreasury first.");
    }

    const before = await manager.advanceOf(accountId);
    if (!before.open) throw new Error("No open advance for this account, so there is nothing to repay.");

    console.log("Account      :", `${PLATFORM}/${ACCOUNT_REF}`);
    console.log("accountId    :", accountId);
    console.log("Owed now     :", `$${(Number(before.outstandingCents) / 100).toFixed(2)}`);
    console.log("Repaying     :", `${XRP_AMOUNT} XRP`);
    console.log("To XRPL acct :", treasuryAddress, "\n");

    // ---------------------------------------------------------------- 1. pay, on the XRP Ledger

    const secret = process.env.XRPL_SECRET;
    if (!secret) throw new Error("XRPL_SECRET is required — the borrower's XRPL seed.");

    const client = new Client(XRPL_RPC);
    await client.connect();

    const wallet = Wallet.fromSeed(secret);
    console.log("Paying from  :", wallet.address);

    /*
     * The accountId travels in the memo, and that is what ties an otherwise anonymous XRP payment to one
     * specific obligation on Flare.
     *
     * FDC's rule for the XRP Ledger is narrow and worth stating exactly, because getting it wrong fails
     * silently: `standardPaymentReference` is set only when the transaction carries **exactly one** memo
     * whose `MemoData` is a hex string of **exactly 32 bytes**. Any other shape — two memos, a shorter
     * memo, or the `InvoiceID` field, which looks like the obvious place for this and is not read at all —
     * leaves the reference as thirty-two zero bytes, and the payment cannot be matched to a debt.
     */
    const prepared = await client.autofill({
        TransactionType: "Payment",
        Account: wallet.address,
        Destination: treasuryAddress,
        Amount: xrpToDrops(XRP_AMOUNT),
        Memos: [{ Memo: { MemoData: accountId.slice(2).toUpperCase() } }],
    });

    const signed = wallet.sign(prepared);
    const submitted = await client.submitAndWait(signed.tx_blob);
    await client.disconnect();

    const meta = submitted.result.meta;
    const result = typeof meta === "object" && meta !== null && "TransactionResult" in meta
        ? (meta as { TransactionResult: string }).TransactionResult
        : "unknown";
    if (result !== "tesSUCCESS") {
        throw new Error(`XRPL payment did not succeed: ${result}`);
    }

    const xrplTxHash = submitted.result.hash;
    console.log("XRPL payment :", xrplTxHash);
    console.log("Explorer     :", `https://testnet.xrpl.org/transactions/${xrplTxHash}\n`);

    // ---------------------------------------------------------------- 2. prove it with FDC

    console.log("Asking FDC to attest that payment...");
    const abiEncodedRequest = await prepareRequest(`0x${xrplTxHash}`);

    const roundId = await submitAttestationRequest(abiEncodedRequest);
    console.log(`Voting round ${roundId}. Waiting for it to finalise.\n`);

    const proof = await retrieveDataAndProofBaseWithRetry(
        `${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`,
        abiEncodedRequest,
        roundId
    );
    console.log("Proof retrieved.\n");

    // ---------------------------------------------------------------- 3. settle it on Flare

    const responseType =
        "tuple(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
        "tuple(bytes32 transactionId,uint256 inUtxo,uint256 utxo) requestBody," +
        "tuple(uint64 blockNumber,uint64 blockTimestamp,bytes32 sourceAddressHash,bytes32 sourceAddressesRoot," +
        "bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount," +
        "int256 intendedSpentAmount,int256 receivedAmount,int256 intendedReceivedAmount," +
        "bytes32 standardPaymentReference,bool oneToOne,uint8 status) responseBody)";

    const decoded = ethers.AbiCoder.defaultAbiCoder().decode([responseType], proof.response_hex)[0];

    console.log("Attested payment:");
    console.log("  received      :", `${Number(decoded.responseBody.receivedAmount) / 1e6} XRP`);
    console.log("  reference     :", decoded.responseBody.standardPaymentReference);
    console.log("  status        :", decoded.responseBody.status.toString(), "(0 is success)");

    if (decoded.responseBody.standardPaymentReference !== accountId) {
        throw new Error(
            `The attested payment reference does not match this account.\n` +
                `  expected ${accountId}\n  got      ${decoded.responseBody.standardPaymentReference}`
        );
    }

    // ethers returns a frozen Result from decode(); rebuild it as a plain object to pass as an argument.
    const data = {
        attestationType: decoded.attestationType,
        sourceId: decoded.sourceId,
        votingRound: decoded.votingRound,
        lowestUsedTimestamp: decoded.lowestUsedTimestamp,
        requestBody: {
            transactionId: decoded.requestBody.transactionId,
            inUtxo: decoded.requestBody.inUtxo,
            utxo: decoded.requestBody.utxo,
        },
        responseBody: {
            blockNumber: decoded.responseBody.blockNumber,
            blockTimestamp: decoded.responseBody.blockTimestamp,
            sourceAddressHash: decoded.responseBody.sourceAddressHash,
            sourceAddressesRoot: decoded.responseBody.sourceAddressesRoot,
            receivingAddressHash: decoded.responseBody.receivingAddressHash,
            intendedReceivingAddressHash: decoded.responseBody.intendedReceivingAddressHash,
            spentAmount: decoded.responseBody.spentAmount,
            intendedSpentAmount: decoded.responseBody.intendedSpentAmount,
            receivedAmount: decoded.responseBody.receivedAmount,
            intendedReceivedAmount: decoded.responseBody.intendedReceivedAmount,
            standardPaymentReference: decoded.responseBody.standardPaymentReference,
            oneToOne: decoded.responseBody.oneToOne,
            status: decoded.responseBody.status,
        },
    };

    const tx = await manager.repayFromXrpl(accountId, { merkleProof: [...proof.proof], data });
    const receipt = await tx.wait();

    const after = await manager.advanceOf(accountId);
    console.log("\nSettled on Flare. tx:", receipt!.hash);
    console.log("Explorer:", `https://coston2-explorer.flare.network/tx/${receipt!.hash}`);
    console.log(
        `Owed: $${(Number(before.outstandingCents) / 100).toFixed(2)} -> ` +
            `$${(Number(after.outstandingCents) / 100).toFixed(2)}`
    );
    if (!after.open) console.log("Advance closed.");
}

void main().then(() => process.exit(0));
