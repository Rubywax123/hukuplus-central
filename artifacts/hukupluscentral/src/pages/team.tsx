import React from "react";
import { useListUsers, useUpdateUserRole } from "@workspace/api-client-react";
import { PageHeader, GlassCard, Select, Badge } from "@/components/ui-extras";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

export default function TeamPage() {
  const { data: users, isLoading } = useListUsers();
  const updateRole = useUpdateUserRole();
  const queryClient = useQueryClient();

  const handleRoleChange = (userId: string, newRole: "admin" | "manager" | "staff") => {
    updateRole.mutate({
      userId,
      data: { role: newRole }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/users`] });
      }
    });
  };

  return (
    <div className="pb-10">
      <PageHeader 
        title="Team Access" 
        description="Manage central command operators and their permission levels."
      />

      <GlassCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center animate-pulse">Loading team members...</div>
        ) : (
          <div className="divide-y divide-white/5">
            {users?.map(u => (
              <div key={u.id} className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-secondary overflow-hidden border border-white/10">
                    {u.profileImageUrl ? (
                      <img src={u.profileImageUrl} alt="User" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-primary font-bold text-lg">
                        {u.firstName?.[0] || "U"}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white">{u.firstName} {u.lastName}</h3>
                    <p className="text-sm text-muted-foreground">{u.email}</p>
                    <p className="text-xs text-muted-foreground mt-1">Joined {format(new Date(u.createdAt), 'MMM yyyy')}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <Badge status={u.role === 'admin' ? 'success' : u.role === 'manager' ? 'warning' : 'neutral'}>
                    {u.role.toUpperCase()}
                  </Badge>
                  <Select 
                    value={u.role} 
                    onChange={e => handleRoleChange(u.id, e.target.value as any)}
                    className="w-32 py-1.5"
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="staff">Staff</option>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
