// run-underwrite sends a real UNDERWRITE/COMPUTE_LIMIT instruction through Flare's data
// providers and prints what the enclave returned.
//
// This is the product operation, not the scaffold's greeting: the enclave receives a set of
// proven revenue periods and returns only a credit limit. The revenue figures go in and never
// come back out, which is the whole point of underwriting inside a TEE — a lender learns what
// someone can borrow without ever learning what they earn.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"math/big"
	"os"
	"time"

	"extension-scaffold/tools/pkg/configs"
	"extension-scaffold/tools/pkg/contracts/helloworld"
	"extension-scaffold/tools/pkg/fccutils"
	"extension-scaffold/tools/pkg/support"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/pkg/errors"
)

// What the enclave is allowed to say back. Deliberately narrow: a limit, and the inputs'
// shape — never the revenue itself.
type underwriteResponse struct {
	AccountID   string `json:"accountId"`
	LimitCents  int64  `json:"limitCents"`
	FactorBps   int64  `json:"factorBps"`
	FeeBps      int64  `json:"feeBps"`
	PeriodsUsed int    `json:"periodsUsed"`
}

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	senderF := flag.String("instructionSender", "", "instructionSender address")
	inputF := flag.String("input", "", "path to the underwriting request JSON")
	flag.Parse()

	senderAddress := common.HexToAddress(*senderF)

	payload, err := os.ReadFile(*inputF)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("reading input: %s", err))
	}
	// Validate before spending gas — a malformed request would only be rejected inside the enclave.
	var probe map[string]any
	if err := json.Unmarshal(payload, &probe); err != nil {
		fccutils.FatalWithCause(errors.Errorf("input is not valid JSON: %s", err))
	}

	s, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	sender, err := helloworld.NewHelloWorldInstructionSender(senderAddress, s.ChainClient)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("binding InstructionSender: %s", err))
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	opts.Value = big.NewInt(1000000) // instruction fee in wei, as the registry requires

	logger.Infof("Sending UNDERWRITE/COMPUTE_LIMIT instruction (%d bytes of request)...", len(payload))
	tx, err := sender.SendComputeLimit(opts, payload)
	if err != nil {
		if reason := fccutils.DecodeRevertReason(err); reason != "" {
			fccutils.FatalWithCause(errors.Errorf("sendComputeLimit: %s (revert: %s)", err, reason))
		}
		fccutils.FatalWithCause(errors.Errorf("sendComputeLimit: %s", err))
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("waiting for transaction: %s", err))
	}
	if receipt.Status != 1 {
		fccutils.FatalWithCause(errors.Errorf("transaction reverted: %s", receipt.TxHash.Hex()))
	}
	if len(receipt.Logs) == 0 {
		fccutils.FatalWithCause(errors.New("no logs in receipt"))
	}

	sent, err := s.TeeVerification.ParseTeeInstructionsSent(*receipt.Logs[0])
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parsing TeeInstructionsSent: %s", err))
	}
	instructionID := common.Hash(sent.InstructionId)
	logger.Infof("Instruction sent. tx: %s", receipt.TxHash.Hex())
	logger.Infof("Instruction ID: %s", instructionID.Hex())

	time.Sleep(5 * time.Second)

	response, err := fccutils.ActionResult(*pf, instructionID)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	result := response.Result

	switch result.Status {
	case 0:
		fccutils.FatalWithCause(errors.Errorf("enclave rejected the request: %s", result.Log))
	case 2:
		fccutils.FatalWithCause(errors.New("instruction still pending after polling"))
	}

	var decision underwriteResponse
	if err := json.Unmarshal(result.Data, &decision); err != nil {
		fccutils.FatalWithCause(errors.Errorf("decoding enclave response: %s", err))
	}

	logger.Infof("Enclave returned: %+v", decision)
	logger.Infof("Raw response: %s", string(result.Data))
	logger.Infof("Credit limit: $%d.%02d", decision.LimitCents/100, decision.LimitCents%100)
	logger.Infof("Done — revenue went in, only a limit came out.")
}
