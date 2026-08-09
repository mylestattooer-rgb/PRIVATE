import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";

export default async function RootPage() {
  const session = await getSession();
  redirect(session ? "/admin" : "/login");
}
