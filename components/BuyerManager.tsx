"use client";

import { useEffect, useState } from "react";

type Buyer = {
  id: string;
  org_name: string;
  contact_email: string;
  revoked_at: string | null;
};

type Folder = { id: string; name: string };

// Seller buyers panel: invite (with folder grants), per-buyer folder-access
// matrix, and revoke (kill switch, INV-2). Mirrors DocumentManager's
// fetch/refresh conventions — optimistic local state, reconciled from the
// API response on write.
export function BuyerManager({
  dealId,
  initialBuyers,
  folders,
}: {
  dealId: string;
  initialBuyers: Buyer[];
  folders: Folder[];
}) {
  const [buyers, setBuyers] = useState<Buyer[]>(initialBuyers);
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});
  const [savingAccess, setSavingAccess] = useState<Record<string, boolean>>({});
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});

  const [inviteOrg, setInviteOrg] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFolders, setInviteFolders] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [inviteWarning, setInviteWarning] = useState<string | null>(null);

  async function loadGrants() {
    const res = await fetch(`/api/deals/${dealId}/buyers/access`);
    const json = await res.json();
    if (res.ok) {
      const g: Record<string, string[]> = json.data.grants;
      setGrants(g);
      setEdits((prev) => {
        const next = { ...prev };
        for (const [buyerId, folderIds] of Object.entries(g)) {
          if (!(buyerId in next)) next[buyerId] = folderIds;
        }
        return next;
      });
    }
  }

  useEffect(() => {
    loadGrants();
  }, [dealId]);

  function toggleInviteFolder(folderId: string) {
    setInviteFolders((f) => (f.includes(folderId) ? f.filter((x) => x !== folderId) : [...f, folderId]));
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteOrg.trim() || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteWarning(null);
    const res = await fetch(`/api/deals/${dealId}/buyers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org_name: inviteOrg.trim(),
        contact_email: inviteEmail.trim(),
        folder_ids: inviteFolders,
      }),
    });
    const json = await res.json();
    setInviting(false);
    if (!res.ok) {
      alert(`Invite failed: ${json.error?.message}`);
      return;
    }
    const buyer: Buyer = {
      id: json.data.buyerId,
      org_name: inviteOrg.trim(),
      contact_email: inviteEmail.trim(),
      revoked_at: null,
    };
    setBuyers((bs) => [...bs, buyer]);
    setEdits((e2) => ({ ...e2, [buyer.id]: inviteFolders }));
    setGrants((g) => ({ ...g, [buyer.id]: inviteFolders }));
    if (!json.data.emailSent) {
      setInviteWarning("Invite created — email not sent (check email settings)");
    }
    setInviteOrg("");
    setInviteEmail("");
    setInviteFolders([]);
  }

  function toggleEdit(buyerId: string, folderId: string) {
    setEdits((e) => {
      const current = e[buyerId] ?? [];
      const next = current.includes(folderId)
        ? current.filter((x) => x !== folderId)
        : [...current, folderId];
      return { ...e, [buyerId]: next };
    });
  }

  async function saveAccess(buyerId: string) {
    setSavingAccess((s) => ({ ...s, [buyerId]: true }));
    const folderIds = edits[buyerId] ?? [];
    const res = await fetch(`/api/deals/${dealId}/buyers/${buyerId}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_ids: folderIds }),
    });
    const json = await res.json();
    setSavingAccess((s) => ({ ...s, [buyerId]: false }));
    if (res.ok) {
      setGrants((g) => ({ ...g, [buyerId]: json.data.folderIds }));
    } else {
      alert(`Save failed: ${json.error?.message}`);
    }
  }

  function requestRevoke(buyerId: string) {
    setConfirming((c) => ({ ...c, [buyerId]: true }));
  }

  async function confirmRevoke(buyerId: string) {
    setRevoking((r) => ({ ...r, [buyerId]: true }));
    const res = await fetch(`/api/deals/${dealId}/buyers/${buyerId}/revoke`, { method: "POST" });
    const json = await res.json();
    setRevoking((r) => ({ ...r, [buyerId]: false }));
    setConfirming((c) => ({ ...c, [buyerId]: false }));
    if (res.ok) {
      setBuyers((bs) => bs.map((b) => (b.id === buyerId ? { ...b, revoked_at: json.data.revokedAt } : b)));
    } else {
      alert(`Revoke failed: ${json.error?.message}`);
    }
  }

  function isDirty(buyerId: string) {
    const saved = new Set(grants[buyerId] ?? []);
    const current = new Set(edits[buyerId] ?? []);
    if (saved.size !== current.size) return true;
    for (const id of saved) if (!current.has(id)) return true;
    return false;
  }

  return (
    <div className="space-y-4">
      <form onSubmit={invite} className="card space-y-3 text-sm">
        <div className="font-medium">Invite a buyer</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Organization name"
            value={inviteOrg}
            onChange={(e) => setInviteOrg(e.target.value)}
            disabled={inviting}
          />
          <input
            className="input"
            type="email"
            placeholder="Contact email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={inviting}
          />
        </div>
        {folders.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-slate-500">Folder access</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {folders.map((f) => (
                <label key={f.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={inviteFolders.includes(f.id)}
                    onChange={() => toggleInviteFolder(f.id)}
                    disabled={inviting}
                  />
                  {f.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={inviting}>
          {inviting ? "Inviting…" : "Send invite"}
        </button>
        {inviteWarning && <p className="text-xs text-amber-600">{inviteWarning}</p>}
      </form>

      <div className="card space-y-3 text-sm">
        {buyers.length === 0 && <p className="text-slate-400">No buyers invited yet.</p>}
        {buyers.map((b) => {
          const revoked = !!b.revoked_at;
          const dirty = isDirty(b.id);
          return (
            <div
              key={b.id}
              className={`space-y-2 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0 ${revoked ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{b.org_name}</div>
                  <div className="truncate text-xs text-slate-400">{b.contact_email}</div>
                </div>
                <span className={`badge ${revoked ? "bg-red-100 text-red-700" : "bg-green-50 text-green-700"}`}>
                  {revoked ? "revoked" : "active"}
                </span>
              </div>

              {folders.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {folders.map((f) => (
                    <label key={f.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={(edits[b.id] ?? []).includes(f.id)}
                        onChange={() => toggleEdit(b.id, f.id)}
                        disabled={revoked}
                      />
                      {f.name}
                    </label>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => saveAccess(b.id)}
                  disabled={revoked || !dirty || savingAccess[b.id]}
                >
                  {savingAccess[b.id] ? "Saving…" : "Save access"}
                </button>
                {!revoked && !confirming[b.id] && (
                  <button type="button" className="text-xs text-red-600" onClick={() => requestRevoke(b.id)}>
                    Revoke
                  </button>
                )}
                {!revoked && confirming[b.id] && (
                  <button
                    type="button"
                    className="text-xs font-medium text-red-700"
                    onClick={() => confirmRevoke(b.id)}
                    disabled={revoking[b.id]}
                  >
                    {revoking[b.id] ? "Revoking…" : "Confirm revoke"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
