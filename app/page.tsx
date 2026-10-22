import { redirect } from "next/navigation";
import { getSessionProfile, HOME_BY_ROLE } from "@/lib/auth";

export default async function Home() {
  const session = await getSessionProfile();
  redirect(session ? HOME_BY_ROLE[session.role] : "/login");
}
