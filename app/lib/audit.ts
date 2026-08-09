import { prisma } from "@/app/lib/db";
import type { AuditAction } from "@prisma/client";

export async function logAudit(params: {
  actorId?: string | null;
  action: AuditAction;
  detail: string;
  metadata?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      action: params.action,
      detail: params.detail,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}
