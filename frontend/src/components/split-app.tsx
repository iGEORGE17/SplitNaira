"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { rpc, Transaction, StrKey } from "@stellar/stellar-sdk";
import { clsx } from "clsx";

import { buildCreateSplitXdr, getSplit } from "@/lib/api";
import { connectFreighter, getFreighterWalletState, signWithFreighter, type WalletState } from "@/lib/freighter";
import { useToast } from "./toast-provider";

interface CollaboratorInput {
  id: string;
  address: string;
  alias: string;
  basisPoints: string;
}

const initialCollaborators: CollaboratorInput[] = [
  { id: crypto.randomUUID(), address: "", alias: "", basisPoints: "5000" },
  { id: crypto.randomUUID(), address: "", alias: "", basisPoints: "5000" }
];

export function SplitApp() {
  const { showToast } = useToast();

  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    network: null
  });
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("music");
  const [token, setToken] = useState("");
  const [collaborators, setCollaborators] = useState<CollaboratorInput[]>(initialCollaborators);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const totalBasisPoints = useMemo(
    () =>
      collaborators.reduce((sum, collaborator) => {
        const parsed = Number.parseInt(collaborator.basisPoints, 10);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0),
    [collaborators]
  );

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const addresses = new Map<string, string>(); // address -> id
    const duplicates = new Set<string>();

    collaborators.forEach((c) => {
      const addr = c.address.trim();
      if (addr) {
        if (!StrKey.isValidEd25519PublicKey(addr) && !StrKey.isValidContract(addr)) {
          errors[c.id] = "Invalid Stellar address (G...) or contract ID (C...)";
        } else {
          if (addresses.has(addr)) {
            duplicates.add(addr);
          } else {
            addresses.set(addr, c.id);
          }
        }
      }
    });

    if (duplicates.size > 0) {
      collaborators.forEach((c) => {
        const addr = c.address.trim();
        if (duplicates.has(addr)) {
          errors[c.id] = "Duplicate address";
        }
      });
    }

    return errors;
  }, [collaborators]);

  const isValid = useMemo(
    () => totalBasisPoints === 10_000 && Object.keys(validationErrors).length === 0,
    [totalBasisPoints, validationErrors]
  );

  useEffect(() => {
    void getFreighterWalletState()
      .then(setWallet)
      .catch(() => {
        setWallet({ connected: false, address: null, network: null });
      });
  }, []);

  async function onConnectWallet() {
    try {
      const state = await connectFreighter();
      setWallet(state);
      showToast("Wallet connected.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet connection failed.";
      showToast(message, "error");
    }
  }

  async function onReconnectWallet() {
    try {
      const state = await getFreighterWalletState();
      setWallet(state);
      showToast(state.connected ? "Wallet reconnected." : "Wallet not authorized.", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet refresh failed.";
      showToast(message, "error");
    }
  }

  function onDisconnectWallet() {
    setWallet({ connected: false, address: null, network: null });
    showToast("Wallet disconnected in app. Reconnect to continue.", "info");
  }

  function updateCollaborator(id: string, patch: Partial<CollaboratorInput>) {
    setCollaborators((prev) =>
      prev.map((collaborator) =>
        collaborator.id === id ? { ...collaborator, ...patch } : collaborator
      )
    );
  }

  function addCollaborator() {
    setCollaborators((prev) => [
      ...prev,
      { id: crypto.randomUUID(), address: "", alias: "", basisPoints: "0" }
    ]);
  }

  function removeCollaborator(id: string) {
    setCollaborators((prev) => (prev.length <= 2 ? prev : prev.filter((c) => c.id !== id)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!wallet.connected || !wallet.address) {
      showToast("Connect Freighter wallet first.", "error");
      return;
    }

    if (!isValid) {
      showToast("Please fix the validation errors before creating the split.", "error");
      return;
    }

    const collaboratorPayload = collaborators.map((collaborator) => ({
      address: collaborator.address.trim(),
      alias: collaborator.alias.trim(),
      basisPoints: Number.parseInt(collaborator.basisPoints, 10)
    }));

    setIsSubmitting(true);
    setTxHash(null);

    try {
      const buildResponse = await buildCreateSplitXdr({
        owner: wallet.address,
        projectId: projectId.trim(),
        title: title.trim(),
        projectType: projectType.trim(),
        token: token.trim(),
        collaborators: collaboratorPayload
      });

      const signedTxXdr = await signWithFreighter(
        buildResponse.xdr,
        buildResponse.metadata.networkPassphrase
      );

      const server = new rpc.Server(
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
        { allowHttp: true }
      );
      const transaction = new Transaction(signedTxXdr, buildResponse.metadata.networkPassphrase);
      const submitResponse = await server.sendTransaction(transaction);

      if (submitResponse.status === "ERROR") {
        throw new Error(submitResponse.errorResult?.toString() ?? "Transaction submission failed.");
      }

      setTxHash(submitResponse.hash ?? null);
      showToast("Split project created successfully.", "success");

      await getSplit(projectId.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create split project.";
      showToast(message, "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-12 md:px-12 selection:bg-greenMid/10 selection:text-greenDeep">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        <header className="glass-card rounded-[2.5rem] p-8 md:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-1">
              <h1 className="font-display text-4xl tracking-tight text-greenDeep">SplitNaira</h1>
              <p className="max-w-md text-sm leading-relaxed text-muted">
                Securely manage royalty distributions with automated splits on the Soroban network.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onConnectWallet}
                className="rounded-full bg-greenDeep px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:bg-greenDeep/90 active:scale-95"
              >
                Connect wallet
              </button>
              <button
                type="button"
                onClick={onReconnectWallet}
                className="rounded-full border border-black/5 bg-white/50 px-6 py-2.5 text-sm font-medium backdrop-blur-sm transition-all hover:bg-white/80"
              >
                Reconnect
              </button>
              <button
                type="button"
                onClick={onDisconnectWallet}
                className="rounded-full border border-black/5 bg-white/50 px-6 py-2.5 text-sm font-medium backdrop-blur-sm transition-all hover:bg-white/80"
              >
                Disconnect
              </button>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-6 text-xs font-medium text-muted/80">
            <div className="flex items-center gap-2">
              <span className={clsx("h-1.5 w-1.5 rounded-full", wallet.connected ? "bg-green-600 animate-pulse" : "bg-red-500")} />
              <span>Status: {wallet.connected ? "Connected" : "Disconnected"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="opacity-50 uppercase tracking-widest text-[10px]">Address</span>
              <span className="font-mono text-ink/80">{wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-6)}` : "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="opacity-50 uppercase tracking-widest text-[10px]">Network</span>
              <span className="text-ink/80">{wallet.network ?? "-"}</span>
            </div>
          </div>
        </header>

        <form onSubmit={onSubmit} className="glass-card rounded-[2.5rem] p-8 md:p-10">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl tracking-tight text-greenDeep">Project Configuration</h2>
            <div className="h-px flex-1 bg-black/5 mx-6" />
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted/70 px-1">Project ID</label>
              <input
                required
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                placeholder="e.g. afrobeats_001"
                className="glass-input w-full rounded-2xl px-4 py-3 text-sm focus:ring-2"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted/70 px-1">Project Title</label>
              <input
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. African Giant"
                className="glass-input w-full rounded-2xl px-4 py-3 text-sm focus:ring-2"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted/70 px-1">Category</label>
              <input
                required
                value={projectType}
                onChange={(event) => setProjectType(event.target.value)}
                placeholder="e.g. Music"
                className="glass-input w-full rounded-2xl px-4 py-3 text-sm focus:ring-2"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted/70 px-1">Token Address</label>
              <div className="flex flex-col gap-1.5">
                <input
                  required
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Contract Address (G... or C...)"
                  className={clsx(
                    "glass-input w-full rounded-2xl px-4 py-3 text-sm focus:ring-2",
                    token && !StrKey.isValidEd25519PublicKey(token) && !StrKey.isValidContract(token) ? "border-red-500 bg-red-50/20" : ""
                  )}
                />
                {token && !StrKey.isValidEd25519PublicKey(token) && !StrKey.isValidContract(token) && (
                  <span className="text-[10px] text-red-600 font-bold px-1 uppercase tracking-tighter">
                    Invalid token address format
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-12 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h3 className="font-display text-xl text-greenDeep">Collaborators</h3>
                <span className="rounded-full bg-greenMid/10 px-2 py-0.5 text-[10px] font-bold text-greenMid">
                  {collaborators.length}
                </span>
              </div>
              <button
                type="button"
                onClick={addCollaborator}
                className="rounded-xl border border-black/5 bg-white/40 px-4 py-2 text-[11px] font-bold uppercase tracking-wider backdrop-blur-sm transition-all hover:bg-white/80 active:scale-95"
              >
                Add Recipient
              </button>
            </div>

            <div className="space-y-4">
              {collaborators.map((collaborator, index) => (
                <div key={collaborator.id} className="group relative grid gap-4 rounded-[1.5rem] border border-black/5 bg-white/30 p-4 transition-all hover:bg-white/50 md:grid-cols-12 md:items-start">
                  <div className="md:col-span-5 space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted/50 px-1">Public Address</label>
                    <input
                      required
                      value={collaborator.address}
                      onChange={(event) => updateCollaborator(collaborator.id, { address: event.target.value })}
                      placeholder={`Recipient #${index + 1}`}
                      className={clsx(
                        "glass-input w-full rounded-xl px-4 py-2.5 text-sm",
                        validationErrors[collaborator.id] ? "border-red-500 bg-red-50/20" : ""
                      )}
                    />
                    {validationErrors[collaborator.id] && (
                      <span className="text-[10px] text-red-600 font-bold px-1 uppercase tracking-tighter">
                        {validationErrors[collaborator.id]}
                      </span>
                    )}
                  </div>
                  <div className="md:col-span-3 space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted/50 px-1">Alias</label>
                    <input
                      required
                      value={collaborator.alias}
                      onChange={(event) => updateCollaborator(collaborator.id, { alias: event.target.value })}
                      placeholder="e.g. Artist"
                      className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div className="md:col-span-3 space-y-1.5">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted/50 px-1">Share (BP)</label>
                    <input
                      required
                      type="number"
                      min={1}
                      max={10_000}
                      value={collaborator.basisPoints}
                      onChange={(event) => updateCollaborator(collaborator.id, { basisPoints: event.target.value })}
                      placeholder="5000"
                      className="glass-input w-full rounded-xl px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div className="md:col-span-1 pt-5">
                    <button
                      type="button"
                      onClick={() => removeCollaborator(collaborator.id)}
                      className="flex h-10 w-full items-center justify-center rounded-xl border border-black/5 bg-white/40 text-muted transition-all hover:bg-red-50 hover:text-red-500"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col items-end gap-2 px-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest text-muted/50">Allocation Matrix</span>
                <span className={clsx(
                  "rounded-lg px-4 py-1.5 text-sm font-bold shadow-sm transition-all",
                  totalBasisPoints === 10_000 ? "bg-greenMid/10 text-greenMid" : "bg-red-50 text-red-600"
                )}>
                  {totalBasisPoints.toLocaleString()} / 10,000 BP
                </span>
              </div>
              {totalBasisPoints !== 10_000 && (
                <p className="text-[10px] font-bold uppercase tracking-tighter text-red-500 animate-bounce">
                  Total must equal 10,000 basis points
                </p>
              )}
            </div>
          </div>

          <div className="mt-10 pt-10 border-t border-black/5">
            <button
              type="submit"
              disabled={isSubmitting || !isValid}
              className="group relative w-full overflow-hidden rounded-[2rem] bg-greenDeep py-5 text-sm font-bold text-white shadow-2xl transition-all hover:shadow-greenDeep/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <div className="absolute inset-0 bg-white/10 opacity-0 transition-opacity group-hover:opacity-100" />
              <span className="relative flex items-center justify-center gap-2 tracking-widest uppercase">
                {isSubmitting ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deploying to Soroban...
                  </>
                ) : (
                  "Finalize & Create Split Contract"
                )}
              </span>
            </button>
          </div>

          {txHash ? (
            <div className="mt-8 rounded-2xl bg-green-50/50 p-4 ring-1 ring-green-500/10 transition-all animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center">
                  <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-green-800 uppercase tracking-widest">Deployment Successful</p>
                  <p className="mt-1 text-xs text-green-700/80">
                    Hash: <span className="font-mono bg-white/50 px-1 rounded">{txHash}</span>
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </main>
  );
}
