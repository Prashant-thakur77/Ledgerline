import { NextResponse } from "next/server";

/**
 * Step two of an attestation: ask the Data Availability layer for the Merkle proof once the voting round
 * has finalised.
 *
 * Also a thin proxy, and also deliberately non-blocking. The browser polls this; if the proof is not ready
 * the route says so immediately rather than sleeping, so no request is ever long enough to be killed by a
 * serverless timeout. The waiting lives in the page, where it is visible.
 */

const DA_LAYER_URL = process.env.COSTON2_DA_LAYER_URL ?? "https://ctn2-data-availability.flare.network";

export async function POST(request: Request) {
    let body: { votingRoundId?: number; requestBytes?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
    }

    const votingRoundId = Number(body.votingRoundId);
    const requestBytes = body.requestBytes;
    if (!Number.isInteger(votingRoundId) || votingRoundId <= 0) {
        return NextResponse.json({ error: "votingRoundId must be a positive integer" }, { status: 400 });
    }
    if (typeof requestBytes !== "string" || !/^0x[0-9a-fA-F]+$/.test(requestBytes)) {
        return NextResponse.json({ error: "requestBytes must be a hex string" }, { status: 400 });
    }

    let response: Response;
    try {
        response = await fetch(`${DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ votingRoundId, requestBytes }),
        });
    } catch (e) {
        return NextResponse.json({ error: `Could not reach the DA layer: ${(e as Error).message}` }, { status: 502 });
    }

    // Before a round is served the DA layer answers with a non-200 or an object with no response_hex.
    // Neither is an error worth surfacing — it means "not yet", and the browser will ask again.
    if (!response.ok) {
        return NextResponse.json({ pending: true, status: response.status });
    }

    const proof = await response.json();
    if (!proof || typeof proof.response_hex !== "string") {
        return NextResponse.json({ pending: true });
    }

    return NextResponse.json({ pending: false, proof });
}
