package service

import (
	"context"
	"errors"
	"time"
)

type RecordingRecoverySummary struct {
	AssembliesRecovered int
	FinalizingRecovered int
}

type recordingRecoveryHooks struct {
	sleep         func(time.Duration)
	recoverAsms   func(context.Context) (int, error)
	recoverFinals func(context.Context) (int, error)
}

var recordingRecoveryHook = recordingRecoveryHooks{
	sleep:         time.Sleep,
	recoverAsms:   RecoverPendingRecordingAssemblies,
	recoverFinals: RecoverPendingFinalizingRecordingJobs,
}

func SetRecordingRecoveryHooksForTest(
	recoverAssemblies func(context.Context) (int, error),
	recoverFinalizing func(context.Context) (int, error),
	sleep func(time.Duration),
) func() {
	previous := recordingRecoveryHook
	if recoverAssemblies != nil {
		recordingRecoveryHook.recoverAsms = recoverAssemblies
	}
	if recoverFinalizing != nil {
		recordingRecoveryHook.recoverFinals = recoverFinalizing
	}
	if sleep != nil {
		recordingRecoveryHook.sleep = sleep
	}
	return func() {
		recordingRecoveryHook = previous
	}
}

func RecoverRecordingTasksAfterBoot(ctx context.Context, delay time.Duration) (RecordingRecoverySummary, error) {
	if delay > 0 {
		recordingRecoveryHook.sleep(delay)
	}

	summary := RecordingRecoverySummary{}
	var errs []error

	assembliesRecovered, err := recordingRecoveryHook.recoverAsms(ctx)
	if err != nil {
		errs = append(errs, err)
	} else {
		summary.AssembliesRecovered = assembliesRecovered
	}

	finalizingRecovered, err := recordingRecoveryHook.recoverFinals(ctx)
	if err != nil {
		errs = append(errs, err)
	} else {
		summary.FinalizingRecovered = finalizingRecovered
	}

	if len(errs) > 0 {
		return summary, errors.Join(errs...)
	}
	return summary, nil
}

func RunRecordingRecoveryAfterBoot(ctx context.Context) (RecordingRecoverySummary, error) {
	return RecoverRecordingTasksAfterBoot(ctx, 0)
}
