import "server-only";
import { prisma } from "@/app/lib/db";
import type { Capability } from "./capabilities";

export { CAPABILITIES } from "./capabilities";
export type { Capability } from "./capabilities";

function parseCapabilities(csv: string): string[] {
  return csv
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Pure check — no DB access. Use when you already have the plan's capability list. */
export function hasCapability(planCapabilities: string[], capability: Capability): boolean {
  return planCapabilities.includes(capability);
}

/**
 * Looks up a student's plan and checks a single capability. A student with no
 * plan assigned has zero capabilities — there is no implicit default grant.
 * This is the one function route handlers / Server Actions should call;
 * never inline a `student.plan === "x"` check at a call site (ARCHITECTURE.md).
 */
export async function studentCan(studentId: string, capability: Capability): Promise<boolean> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { plan: { select: { capabilities: true } } },
  });
  if (!student?.plan) return false;
  return hasCapability(parseCapabilities(student.plan.capabilities), capability);
}
