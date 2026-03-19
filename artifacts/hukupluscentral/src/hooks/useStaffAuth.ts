import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type StaffUser = {
  staffUserId: number;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "staff";
  mustChangePassword?: boolean;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function staffFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function useStaffAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading, error } = useQuery<StaffUser>({
    queryKey: ["/api/staff/me"],
    queryFn: () => staffFetch("/api/staff/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      staffFetch("/api/staff/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff/me"] }),
  });

  const logoutMutation = useMutation({
    mutationFn: () => staffFetch("/api/staff/logout", { method: "POST" }),
    onSuccess: () => queryClient.setQueryData(["/api/staff/me"], null),
  });

  const changePasswordMutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      staffFetch("/api/staff/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff/me"] }),
  });

  const isAuthenticated = !!user && !error;

  return {
    user,
    isLoading,
    isAuthenticated,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error?.message,
    isLoggingIn: loginMutation.isPending,
    logout: () => logoutMutation.mutate(),
    changePassword: changePasswordMutation.mutateAsync,
    isChangingPassword: changePasswordMutation.isPending,
    changePasswordError: changePasswordMutation.error?.message,
  };
}
