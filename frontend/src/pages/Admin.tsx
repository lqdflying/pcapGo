import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAllowedUsers,
  addAllowedUser,
  removeAllowedUser,
  updateAllowedUserRole,
  getGeoIPStatus,
  updateGeoIPDatabase,
  uploadGeoIPDatabase,
  type AllowedUser,
  type GeoIPStatus,
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
  Globe,
  Upload,
  Download,
} from "lucide-react";

export function AdminPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newLogin, setNewLogin] = useState("");
  const [newRole, setNewRole] = useState<"user" | "super_admin">("user");
  const [error, setError] = useState<string | null>(null);
  const [geoipUrl, setGeoipUrl] = useState("");
  const [geoipError, setGeoipError] = useState<string | null>(null);
  const [geoipSuccess, setGeoipSuccess] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: listAllowedUsers,
  });

  const geoipQuery = useQuery({
    queryKey: ["admin", "geoip"],
    queryFn: getGeoIPStatus,
  });

  const geoipUpdateMut = useMutation({
    mutationFn: (url: string) => updateGeoIPDatabase(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "geoip"] });
      setGeoipUrl("");
      setGeoipError(null);
      setGeoipSuccess(t("admin.geoipUpdateSuccess"));
      setTimeout(() => setGeoipSuccess(null), 5000);
    },
    onError: (err: any) => {
      setGeoipError(err.response?.data?.detail || t("admin.geoipUpdateFailed"));
    },
  });

  const geoipUploadMut = useMutation({
    mutationFn: (file: File) => uploadGeoIPDatabase(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "geoip"] });
      setGeoipError(null);
      setGeoipSuccess(t("admin.geoipUpdateSuccess"));
      setTimeout(() => setGeoipSuccess(null), 5000);
    },
    onError: (err: any) => {
      setGeoipError(err.response?.data?.detail || t("admin.geoipUploadFailed"));
    },
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
      setError(err.response?.data?.detail || t("admin.failedToAdd"));
    },
  });

  const deleteMut = useMutation({
    mutationFn: removeAllowedUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || t("admin.failedToRemove"));
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
      setError(err.response?.data?.detail || t("admin.failedToUpdate"));
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
            title={t("admin.backToDashboard")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-panel-text">
              {t("admin.userManagement")}
            </h1>
            <p className="text-xs text-panel-muted">
              {t("admin.manageUsers")}
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
              {t("admin.githubUsername")}
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
              {t("admin.role")}
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "user" | "super_admin")}
              className="rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm text-panel-text focus:border-panel-accent focus:outline-none"
            >
              <option value="user">{t("admin.userRole")}</option>
              <option value="super_admin">{t("admin.superAdmin")}</option>
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
            {t("admin.addUser")}
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
            {data ? t("admin.allowedUsersCount", { count: data.total }) : t("admin.allowedUsers")}
          </h2>
        </div>

        {isLoading ? (
          <p className="text-sm text-panel-muted">{t("common.loading")}</p>
        ) : isError ? (
          <p className="text-sm text-panel-error">
            {t("admin.failedToLoad")}
          </p>
        ) : !data?.users?.length ? (
          <p className="text-sm text-panel-muted">
            {t("admin.noUsers")}
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
                          {t("admin.seedAdmin")}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-panel-muted">
                      {au.role === "super_admin" ? t("admin.superAdmin") : t("admin.userRole")}
                      {au.added_by && ` · ${t("admin.addedBy", { name: au.added_by })}`}
                      {" · "}
                      {new Date(au.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {au.has_logged_in ? (
                    <span className="inline-flex items-center gap-1 text-xs text-panel-success">
                      <CheckCircle className="h-3.5 w-3.5" /> {t("admin.active")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-panel-muted">
                      <Clock className="h-3.5 w-3.5" /> {t("admin.pending")}
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
                        <option value="user">{t("admin.userRole")}</option>
                        <option value="super_admin">{t("admin.superAdmin")}</option>
                      </select>
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              t("admin.removeConfirm", { login: au.github_login })
                            )
                          ) {
                            deleteMut.mutate(au.github_login);
                          }
                        }}
                        className="rounded-lg p-1.5 text-panel-muted transition hover:bg-panel-error/10 hover:text-panel-error"
                        title={t("admin.removeUser")}
                        aria-label={t("admin.removeUser")}
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

        {/* GeoIP Database Management */}
        <div className="mt-8">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-panel-muted" />
            <h2 className="text-sm font-medium text-panel-muted">
              {t("admin.geoipManagement")}
            </h2>
          </div>
          <p className="mb-3 text-xs text-panel-muted">{t("admin.geoipDescription")}</p>

          {/* Status */}
          <div className="mb-4 rounded-lg border border-panel-border bg-panel-header/50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-panel-muted">Status:</span>
              {geoipQuery.data?.available ? (
                <span className="inline-flex items-center gap-1 text-panel-success">
                  <CheckCircle className="h-3.5 w-3.5" /> {t("admin.geoipAvailable")}
                </span>
              ) : (
                <span className="text-panel-warning">{t("admin.geoipUnavailable")}</span>
              )}
            </div>
            {geoipQuery.data?.available && (
              <div className="mt-1 text-xs text-panel-muted">
                {geoipQuery.data.file_size != null && (
                  <span className="mr-4">
                    {t("admin.geoipFileSize")}: {(geoipQuery.data.file_size / 1024 / 1024).toFixed(1)} MB
                  </span>
                )}
                {geoipQuery.data.last_modified && (
                  <span>
                    {t("admin.geoipLastModified")}: {new Date(geoipQuery.data.last_modified).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Download from URL */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (geoipUrl.trim()) {
                setGeoipError(null);
                setGeoipSuccess(null);
                geoipUpdateMut.mutate(geoipUrl.trim());
              }
            }}
            className="mb-3 flex items-end gap-3"
          >
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-panel-muted">
                {t("admin.geoipUpdateUrl")}
              </label>
              <input
                type="url"
                value={geoipUrl}
                onChange={(e) => setGeoipUrl(e.target.value)}
                placeholder={t("admin.geoipUpdateUrlPlaceholder")}
                className="w-full rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm text-panel-text placeholder-panel-muted/50 focus:border-panel-accent focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!geoipUrl.trim() || geoipUpdateMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-panel-accent px-4 py-2 text-sm font-medium text-panel-header transition hover:bg-panel-accent/80 disabled:opacity-50"
            >
              {geoipUpdateMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {geoipUpdateMut.isPending ? t("admin.geoipUpdating") : t("admin.geoipUpdate")}
            </button>
          </form>

          {/* Upload .mmdb file */}
          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-panel-border px-4 py-2 text-sm text-panel-text transition hover:bg-panel-border">
              {geoipUploadMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {geoipUploadMut.isPending ? t("admin.geoipUploading") : t("admin.geoipUpload")}
              <input
                type="file"
                accept=".mmdb"
                className="hidden"
                disabled={geoipUploadMut.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setGeoipError(null);
                    setGeoipSuccess(null);
                    geoipUploadMut.mutate(file);
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {geoipError && (
            <p className="mt-2 text-sm text-panel-error">{geoipError}</p>
          )}
          {geoipSuccess && (
            <p className="mt-2 text-sm text-panel-success">{geoipSuccess}</p>
          )}
        </div>
      </main>
    </div>
  );
}
