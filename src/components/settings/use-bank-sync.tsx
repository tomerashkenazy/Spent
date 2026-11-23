"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { startSync, submitSyncOtp, type SyncProgressEvent } from "@/lib/api";

export interface SyncState {
  syncing: boolean;
  stage: string;
}

/** A provider waiting for the SMS code the user received. */
export interface OtpRequest {
  credentialId: number;
  syncRunId: number;
  provider: string;
}

export function useBankSync() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<Record<number, SyncState>>({});
  const [otpRequest, setOtpRequest] = useState<OtpRequest | null>(null);
  const cancels = useRef<Map<number, () => void>>(new Map());

  const clearOtp = useCallback((credentialId: number) => {
    setOtpRequest((prev) => (prev?.credentialId === credentialId ? null : prev));
  }, []);

  const start = useCallback(
    (credentialId: number) => {
      setState((prev) => ({
        ...prev,
        [credentialId]: { syncing: true, stage: "Connecting…" },
      }));
      let failed = false;
      const { cancel } = startSync(credentialId, (event: SyncProgressEvent) => {
        if (event.type === "provider-start") {
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: true, stage: "Pulling transactions…" },
          }));
        } else if (event.type === "provider-2fa-needed") {
          setOtpRequest({
            credentialId,
            syncRunId: event.data.syncRunId as number,
            provider: event.data.provider as string,
          });
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: true, stage: "Waiting for the SMS code…" },
          }));
        } else if (event.type === "provider-2fa-submitted") {
          clearOtp(credentialId);
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: true, stage: "Verifying code…" },
          }));
        } else if (event.type === "provider-2fa-manual") {
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: true, stage: "Solve 2FA in popup…" },
          }));
        } else if (event.type === "stage") {
          const s = event.data.stage as string;
          setState((prev) => ({
            ...prev,
            [credentialId]: {
              syncing: true,
              stage: s === "categorizing" ? "Categorizing…" : "Working…",
            },
          }));
        } else if (event.type === "provider-done") {
          clearOtp(credentialId);
          if (event.data.ok === false) {
            failed = true;
            toast.error(
              (event.data.errorMessage as string | undefined) ?? "Sync failed",
              { duration: Infinity, closeButton: true }
            );
          }
        } else if (event.type === "complete") {
          cancels.current.delete(credentialId);
          clearOtp(credentialId);
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: false, stage: "" },
          }));
          queryClient.invalidateQueries({ queryKey: ["integrations"] });
          // The failure was already shown from provider-done.
          if (failed) return;
          const data = event.data as {
            added: number;
            updated: number;
            categorized: number;
          };
          toast.success(
            `Sync complete: ${data.added} new, ${data.updated} updated, ${data.categorized} categorized`
          );
          queryClient.invalidateQueries({ queryKey: ["integrations"] });
          queryClient.invalidateQueries({ queryKey: ["summary"] });
          queryClient.invalidateQueries({ queryKey: ["transactions"] });
        } else if (event.type === "error") {
          cancels.current.delete(credentialId);
          clearOtp(credentialId);
          setState((prev) => ({
            ...prev,
            [credentialId]: { syncing: false, stage: "" },
          }));
          toast.error((event.data.message as string) ?? "Sync failed", {
            duration: Infinity,
            closeButton: true,
          });
        }
      });
      cancels.current.set(credentialId, cancel);
    },
    [queryClient, clearOtp]
  );

  const submitOtp = useCallback(async (syncRunId: number, code: string) => {
    await submitSyncOtp(syncRunId, code);
  }, []);

  /** Gives up on the code: stops that sync. */
  const cancelOtp = useCallback(() => {
    if (!otpRequest) return;
    const { credentialId } = otpRequest;
    cancels.current.get(credentialId)?.();
    cancels.current.delete(credentialId);
    setOtpRequest(null);
    setState((prev) => ({ ...prev, [credentialId]: { syncing: false, stage: "" } }));
  }, [otpRequest]);

  const stateFor = (credentialId: number): SyncState =>
    state[credentialId] ?? { syncing: false, stage: "" };

  const anySyncing = Object.values(state).some((s) => s.syncing);

  return { start, stateFor, anySyncing, otpRequest, submitOtp, cancelOtp };
}
