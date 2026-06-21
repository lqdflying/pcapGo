import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAllowedUsers,
  addAllowedUser,
  removeAllowedUser,
  updateAllowedUserRole,
  type AllowedUser,
} from "../api/client";
import { useAuthStore } from "../lib/store";
import {
  ArrowLeft,
  UserPlus,
  Trash2,
  Shield,
  ShieldCheck,
  Users,
  CheckCircle,
  Clock,
  Loader2,
} from "lucide-react";

export function AdminPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newLogin, setNewLogin] = useState("");
  const [newRole, setNewRole] = useState<"user" | "super_admin">("user");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: listAllowedUsers,
  });

  const addMut = useMutation({
    mutationFn: () => addAllowedUser(newLogin.trim(), newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setNewLogin("");
      setNewRole("user");
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || "Failed to add user");
    },
  });

  const deleteMut = useMutation({
    mutationFn: removeAllowedUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || "Failed to remove user");
    },
  });

  const updateRoleMut = useMutation({
    mutationFn: ({ login, role }: { login: string; role: string }) =>
      updateAllowedUserRole(login, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || "Failed to update role");
    },
  });

  const handleAdd = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!newLogin.trim()) return;
      setError(null);
      addMut.mutate();
    },
    [newLogin, newRole]
  );

  const isSeedAdmin = (au: AllowedUser) =>
    au.role === "super_admin" && au.added_by === null;

  return (
    <div className="flex h-full flex-col bg-panel-bg">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-panel-border bg-panel-header px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="rounded-lg p-2 text-panel-muted transition hover:bg-panel-border hover:text-panel-text"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-panel-text">
              User Management
            </h1>
            <p className="text-xs text-panel-muted">
              Manage allowed GitHub users
            </p>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-2 text-sm text-panel-muted">
            <ShieldCheck className="h-4 w-4 text-panel-accent" />
            <span>{user.login}</span>
          </div>
        )}
      </header>

      {/* Add user form */}
      <div className="border-b border-panel-border px-6 py-4">
        <form onSubmit={handleAdd} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-panel-muted">
              GitHub Username
            </label>
            <input
              type="text"
              value={newLogin}
              onChange={(e) => setNewLogin(e.target.value)}
              placeholder="octocat"
              className="w-full rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm text-panel-text placeholder-panel-muted/50 focus:border-panel-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-panel-muted">
              Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "user" | "super_admin")}
              className="rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm text-panel-text focus:border-panel-accent focus:outline-none"
            >
              <option value="user">User</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={!newLogin.trim() || addMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-panel-accent px-4 py-2 text-sm font-medium text-panel-header transition hover:bg-panel-accent/80 disabled:opacity-50"
          >
            {addMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Add User
          </button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-panel-error">{error}</p>
        )}
      </div>

      {/* Users list */}
      <main className="flex-1 overflow-auto px-6 py-4">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-panel-muted" />
          <h2 className="text-sm font-medium text-panel-muted">
            Allowed Users{data ? ` (${data.total})` : ""}
          </h2>
        </div>

        {isLoading ? (
          <p className="text-sm text-panel-muted">Loading...</p>
        ) : isError ? (
          <p className="text-sm text-panel-error">
            Failed to load allowed users. Please try again.
          </p>
        ) : !data?.users?.length ? (
          <p className="text-sm text-panel-muted">
            No users configured. Add a GitHub username above.
          </p>
        ) : (
          <div className="space-y-2">
            {data.users.map((au: AllowedUser) => (
              <div
                key={au.id}
                className="flex items-center justify-between rounded-lg border border-panel-border bg-panel-header/50 px-4 py-3 transition"
              >
                <div className="flex items-center gap-3">
                  {au.role === "super_admin" ? (
                    <ShieldCheck className="h-5 w-5 text-panel-accent" />
                  ) : (
                    <Shield className="h-5 w-5 text-panel-muted" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-panel-text">
                      {au.github_login}
                      {isSeedAdmin(au) && (
                        <span className="ml-2 text-xs text-panel-accent">
                          Seed Admin
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-panel-muted">
                      {au.role === "super_admin" ? "Super Admin" : "User"}
                      {au.added_by && ` · Added by ${au.added_by}`}
                      {" · "}
                      {new Date(au.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {au.has_logged_in ? (
                    <span className="inline-flex items-center gap-1 text-xs text-panel-success">
                      <CheckCircle className="h-3.5 w-3.5" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-panel-muted">
                      <Clock className="h-3.5 w-3.5" /> Pending
                    </span>
                  )}

                  {!isSeedAdmin(au) && (
                    <>
                      <select
                        value={au.role}
                        disabled={updateRoleMut.isPending}
                        onChange={(e) =>
                          updateRoleMut.mutate({
                            login: au.github_login,
                            role: e.target.value,
                          })
                        }
                        className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:outline-none"
                      >
                        <option value="user">User</option>
                        <option value="super_admin">Super Admin</option>
                      </select>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove "${au.github_login}" from allowed users?`
                            )
                          ) {
                            deleteMut.mutate(au.github_login);
                          }
                        }}
                        className="rounded-lg p-1.5 text-panel-muted transition hover:bg-panel-error/10 hover:text-panel-error"
                        title="Remove user"
                        aria-label="Remove user"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
