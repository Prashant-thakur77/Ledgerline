// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title PrivateUnderwriter
 * @notice The on-chain half of Phase 4: accepts an underwriting decision computed inside a Flare
 * Confidential Compute enclave, and stores it — the limit, the tier, the fee. Never the revenue.
 *
 * The enclave (see `fcc/`) receives the revenue history, runs the same tier arithmetic AdvanceManager
 * uses, and signs only the decision. This contract verifies that signature against the registered enclave
 * key and the registered code hash, so what governs a borrower's limit is a *measurement* — audited code
 * whose hash is public — rather than a server anyone must take on faith.
 *
 * Trust honestly stated: until the extension is registered on Flare's TEE platform (a step gated on
 * platform access, not on code — see fcc/README.md), the "enclave key" is whatever governance sets here.
 * The verification machinery is the same either way; registration upgrades who holds the key, not how
 * the contract checks it.
 */
contract PrivateUnderwriter is Ownable {
    struct PrivateLimit {
        uint256 limitCents;
        uint16 factorBps;
        uint16 feeBps;
        uint64 computedAt;
    }

    /// @notice The key the enclave signs decisions with. Production: from the TEE platform's attestation.
    address public enclaveSigner;

    /// @notice The measurement of the extension whose decisions are accepted. Changing the underwriting
    /// policy changes this hash — a public, governed rollout rather than a silent edit.
    bytes32 public extensionCodeHash;

    /// @notice A decision older than this at submission is refused; stale limits are not limits.
    uint64 public constant MAX_DECISION_AGE = 1 days;

    /// @notice Tolerated clock skew for a decision stamped slightly ahead of this chain.
    uint64 public constant MAX_CLOCK_SKEW = 5 minutes;

    mapping(bytes32 => PrivateLimit) private _limits;

    event EnclaveSet(address signer, bytes32 codeHash);
    event PrivateLimitStored(
        bytes32 indexed accountId,
        uint256 limitCents,
        uint16 factorBps,
        uint16 feeBps,
        uint64 computedAt
    );

    error NotEnclaveSigner(address recovered, address expected);
    error StaleDecision(uint64 computedAt, uint256 nowTs);
    error FutureDecision(uint64 computedAt, uint256 nowTs);
    error ReplayedDecision(uint64 computedAt, uint64 storedAt);
    error EnclaveUnset();

    constructor() Ownable(msg.sender) {}

    /// @notice Register which enclave to believe: its signing key and its code measurement.
    function setEnclave(address signer, bytes32 codeHash) external onlyOwner {
        enclaveSigner = signer;
        extensionCodeHash = codeHash;
        emit EnclaveSet(signer, codeHash);
    }

    /**
     * @notice Store an enclave-signed underwriting decision.
     * @dev The signature covers the code hash too, so a decision signed by the right key but computed by
     * a different (unregistered) build of the policy is refused. Monotonic `computedAt` is the replay
     * guard: each stored decision must be newer than the last.
     */
    function submitPrivateLimit(
        bytes32 accountId,
        uint256 limitCents,
        uint16 factorBps,
        uint16 feeBps,
        uint64 computedAt,
        bytes calldata signature
    ) external {
        if (enclaveSigner == address(0)) revert EnclaveUnset();

        if (computedAt + MAX_DECISION_AGE < block.timestamp) {
            revert StaleDecision(computedAt, block.timestamp);
        }
        if (computedAt > block.timestamp + MAX_CLOCK_SKEW) {
            revert FutureDecision(computedAt, block.timestamp);
        }
        uint64 storedAt = _limits[accountId].computedAt;
        if (computedAt <= storedAt) revert ReplayedDecision(computedAt, storedAt);

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(accountId, limitCents, factorBps, feeBps, computedAt, extensionCodeHash))
        );
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != enclaveSigner) revert NotEnclaveSigner(recovered, enclaveSigner);

        _limits[accountId] = PrivateLimit(limitCents, factorBps, feeBps, computedAt);
        emit PrivateLimitStored(accountId, limitCents, factorBps, feeBps, computedAt);
    }

    function privateLimitOf(bytes32 accountId) external view returns (PrivateLimit memory) {
        return _limits[accountId];
    }
}
