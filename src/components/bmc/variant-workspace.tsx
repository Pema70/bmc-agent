"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { acceptProposalAction, rejectProposalAction } from "@/app/projekty/[id]/proposal-actions";
import type { BmcState } from "@/lib/schemas/bmc";
import type { ProposalItem, ProposalStatus, ProposalView } from "@/lib/schemas/proposal";

export const DIRTY_MESSAGE = "Najpierw zapisz albo cofnij swoje zmiany";
const GENERIC_ERROR = "Nie udało się wykonać operacji. Sprawdź połączenie i spróbuj ponownie.";
const ACCEPTED_NOTE = "Zmiana zastosowana na płótnie.";

export type ProposalFeedback = { kind: "error" | "note"; text: string };
export type WorkspaceBusy = { id: string; kind: "accept" | "reject" } | null;

export type VariantWorkspaceValue = {
  projectId: string;
  variantId: string;
  // Ostatnia znana wersja i stan wariantu na serwerze: wspólne dla edytora i czatu.
  version: number;
  serverState: BmcState;
  // Rośnie po akceptacji propozycji: edytor przejmuje wtedy serverState (akceptacja jest zablokowana
  // przy niezapisanych zmianach, a edytor jest zablokowany na czas żądania, więc nic nie zgubi).
  adoptRevision: number;
  dirty: boolean;
  proposals: Record<string, ProposalItem>;
  busy: WorkspaceBusy;
  feedback: Record<string, ProposalFeedback>;
  setDirty: (dirty: boolean) => void;
  onSaved: (version: number, state: BmcState) => void;
  registerProposals: (views: readonly ProposalView[]) => void;
  accept: (proposalId: string) => Promise<void>;
  reject: (proposalId: string) => Promise<void>;
};

const WorkspaceContext = createContext<VariantWorkspaceValue | null>(null);

export function useVariantWorkspace(): VariantWorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useVariantWorkspace wymaga VariantWorkspaceProvider.");
  }
  return value;
}

export type VariantWorkspaceProviderProps = {
  projectId: string;
  variantId: string;
  initialVersion: number;
  initialState: BmcState;
  // Od najstarszej do najnowszej.
  initialProposals: ProposalItem[];
  children: ReactNode;
};

export function VariantWorkspaceProvider({
  projectId,
  variantId,
  initialVersion,
  initialState,
  initialProposals,
  children,
}: VariantWorkspaceProviderProps) {
  const [version, setVersion] = useState(initialVersion);
  const [serverState, setServerState] = useState<BmcState>(initialState);
  const [adoptRevision, setAdoptRevision] = useState(0);
  const [dirty, setDirtyState] = useState(false);
  const [proposals, setProposals] = useState<Record<string, ProposalItem>>(() =>
    Object.fromEntries(initialProposals.map((proposal) => [proposal.id, proposal])),
  );
  const [busy, setBusy] = useState<WorkspaceBusy>(null);
  const [feedback, setFeedback] = useState<Record<string, ProposalFeedback>>({});

  // Refy dają funkcjom asynchronicznym zawsze aktualną wartość (bez nieaktualnych domknięć).
  const versionRef = useRef(initialVersion);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);

  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  }, []);

  const onSaved = useCallback((newVersion: number, state: BmcState) => {
    versionRef.current = newVersion;
    setVersion(newVersion);
    setServerState(state);
  }, []);

  const registerProposals = useCallback((views: readonly ProposalView[]) => {
    setProposals((current) => {
      let next = current;
      for (const view of views) {
        if (!(view.id in current)) {
          next = next === current ? { ...current } : next;
          next[view.id] = { ...view, status: "PENDING" };
        }
      }
      return next;
    });
  }, []);

  const setStatus = useCallback((id: string, status: ProposalStatus) => {
    setProposals((current) => (current[id] ? { ...current, [id]: { ...current[id], status } } : current));
  }, []);

  const setFeedbackFor = useCallback((id: string, value: ProposalFeedback | null) => {
    setFeedback((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
      return value ? { ...rest, [id]: value } : rest;
    });
  }, []);

  const accept = useCallback(
    async (proposalId: string) => {
      // Blokada po stronie interfejsu; serwer i tak chroni stan kontrolą wersji.
      if (dirtyRef.current) {
        setFeedbackFor(proposalId, { kind: "error", text: DIRTY_MESSAGE });
        return;
      }
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy({ id: proposalId, kind: "accept" });
      setFeedbackFor(proposalId, null);
      try {
        const result = await acceptProposalAction(projectId, variantId, proposalId, versionRef.current);
        if (result.ok) {
          versionRef.current = result.version;
          setVersion(result.version);
          setServerState(result.state);
          setAdoptRevision((revision) => revision + 1);
          setStatus(proposalId, "ACCEPTED");
          setFeedbackFor(proposalId, { kind: "note", text: ACCEPTED_NOTE });
        } else {
          if (result.error === "ALREADY_RESOLVED") {
            setStatus(proposalId, "ACCEPTED");
          }
          setFeedbackFor(proposalId, { kind: "error", text: result.message });
        }
      } catch (error) {
        console.error("Akceptacja propozycji nie powiodła się", error);
        setFeedbackFor(proposalId, { kind: "error", text: GENERIC_ERROR });
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [projectId, variantId, setFeedbackFor, setStatus],
  );

  const reject = useCallback(
    async (proposalId: string) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy({ id: proposalId, kind: "reject" });
      setFeedbackFor(proposalId, null);
      try {
        const result = await rejectProposalAction(projectId, variantId, proposalId);
        if (result.ok) {
          setStatus(proposalId, "REJECTED");
        } else {
          setFeedbackFor(proposalId, { kind: "error", text: result.message });
        }
      } catch (error) {
        console.error("Odrzucenie propozycji nie powiodło się", error);
        setFeedbackFor(proposalId, { kind: "error", text: GENERIC_ERROR });
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [projectId, variantId, setFeedbackFor, setStatus],
  );

  const value = useMemo<VariantWorkspaceValue>(
    () => ({
      projectId,
      variantId,
      version,
      serverState,
      adoptRevision,
      dirty,
      proposals,
      busy,
      feedback,
      setDirty,
      onSaved,
      registerProposals,
      accept,
      reject,
    }),
    [
      projectId,
      variantId,
      version,
      serverState,
      adoptRevision,
      dirty,
      proposals,
      busy,
      feedback,
      setDirty,
      onSaved,
      registerProposals,
      accept,
      reject,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
