// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ContractRegistry } from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import { IWeb2Json } from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title RevenueOracle
 * @notice Turns an FDC Web2Json attestation of a payment processor's API into a verified on-chain fact.
 *
 * The contract knows nothing about Stripe. It takes an opaque (platform, accountRef) pair, so adding
 * Shopify or YouTube later is a change to the attestation script, not to this contract.
 */
contract RevenueOracle {
    /// @notice The shape the jq reduction produces, and which `abiSignature` describes.
    struct RevenueDTO {
        string platform;
        string accountRef;
        uint256 revenueCents;
        uint256 periodStart;
        uint256 periodEnd;
    }

    struct RevenueRecord {
        uint256 revenueCents;
        uint64 periodStart;
        uint64 periodEnd;
        uint64 provenAt;
        /// @notice The FDC voting round that agreed this figure.
        uint64 votingRound;
        /// @notice The Merkle root the proof resolves to — checkable against what the Relay published
        /// for `votingRound`, so anyone can confirm this record independently of us.
        bytes32 merkleRoot;
    }

    /// @notice First wallet to prove an account owns it. Only it may attest for that account afterwards.
    mapping(bytes32 => address) public accountOwner;

    mapping(bytes32 => RevenueRecord[]) private _history;

    /// @notice Keyed on the attested response bytes, so one attestation can never be consumed twice.
    mapping(bytes32 => bool) public attestationUsed;

    event AccountBound(bytes32 indexed accountId, address indexed owner, string platform);
    event RevenueProven(
        bytes32 indexed accountId,
        address indexed owner,
        uint256 revenueCents,
        uint64 periodStart,
        uint64 periodEnd,
        uint64 votingRound,
        bytes32 merkleRoot
    );

    error InvalidProof();
    error AccountMismatch(bytes32 claimed, bytes32 attested);
    error InvalidPeriod();
    error AttestationAlreadyUsed();
    error NotAccountOwner(address owner, address caller);
    error StalePeriod(uint64 latestPeriodEnd, uint64 submittedPeriodEnd);
    error NoRevenueProven();

    /// @notice Account identity is derived from the attested payload, so it cannot be spoofed by the caller.
    function accountIdFor(string memory platform, string memory accountRef) public pure returns (bytes32) {
        return keccak256(abi.encode(platform, accountRef));
    }

    /**
     * @notice Verify an attested revenue figure and record it against `claimedAccountId`.
     * @param claimedAccountId The account the caller says this attestation is for. Checked against the
     * payload rather than trusted, so an attestation for account A can never satisfy a claim about B.
     */
    function submitAttestation(bytes32 claimedAccountId, IWeb2Json.Proof calldata proof) external {
        if (!_verifyProof(proof)) revert InvalidProof();

        RevenueDTO memory dto = abi.decode(proof.data.responseBody.abiEncodedData, (RevenueDTO));

        bytes32 accountId = accountIdFor(dto.platform, dto.accountRef);
        if (accountId != claimedAccountId) revert AccountMismatch(claimedAccountId, accountId);

        if (dto.periodEnd <= dto.periodStart || dto.periodEnd > type(uint64).max) revert InvalidPeriod();

        bytes32 attestationKey = keccak256(proof.data.responseBody.abiEncodedData);
        if (attestationUsed[attestationKey]) revert AttestationAlreadyUsed();

        address owner = accountOwner[accountId];
        if (owner == address(0)) {
            accountOwner[accountId] = msg.sender;
            owner = msg.sender;
            emit AccountBound(accountId, msg.sender, dto.platform);
        } else if (owner != msg.sender) {
            revert NotAccountOwner(owner, msg.sender);
        }

        RevenueRecord[] storage records = _history[accountId];
        if (records.length > 0) {
            uint64 latestEnd = records[records.length - 1].periodEnd;
            if (uint64(dto.periodEnd) <= latestEnd) revert StalePeriod(latestEnd, uint64(dto.periodEnd));
        }

        attestationUsed[attestationKey] = true;
        records.push(
            RevenueRecord({
                revenueCents: dto.revenueCents,
                periodStart: uint64(dto.periodStart),
                periodEnd: uint64(dto.periodEnd),
                provenAt: uint64(block.timestamp),
                votingRound: proof.data.votingRound,
                merkleRoot: MerkleProof.processProof(proof.merkleProof, keccak256(abi.encode(proof.data)))
            })
        );

        RevenueRecord storage stored = records[records.length - 1];
        emit RevenueProven(
            accountId,
            owner,
            stored.revenueCents,
            stored.periodStart,
            stored.periodEnd,
            stored.votingRound,
            stored.merkleRoot
        );
    }

    function latestRevenue(bytes32 accountId) external view returns (RevenueRecord memory) {
        RevenueRecord[] storage records = _history[accountId];
        if (records.length == 0) revert NoRevenueProven();
        return records[records.length - 1];
    }

    function revenueHistory(bytes32 accountId) external view returns (RevenueRecord[] memory) {
        return _history[accountId];
    }

    function attestationCount(bytes32 accountId) external view returns (uint256) {
        return _history[accountId].length;
    }

    /// @dev Present so the DTO type lands in the ABI for the off-chain attestation script to encode against.
    function abiSignatureHack(RevenueDTO calldata dto) external pure {}

    /// @dev Overridden in tests. Production path is Flare's own verification contract.
    function _verifyProof(IWeb2Json.Proof calldata proof) internal view virtual returns (bool) {
        return ContractRegistry.getFdcVerification().verifyWeb2Json(proof);
    }
}
