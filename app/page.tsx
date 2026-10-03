import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import StartForm from "./StartForm";

export default async function Start() {
  if (await getSession()) redirect("/leave");
  const known = (await cookies()).get("cp_name")?.value;
  return (
    <div className="mx-auto max-w-sm pt-4 text-center">
      <p className="bob text-5xl" style={{ ["--r" as string]: "-6deg" }}>🛺</p>
      <h1 className="font-pixel mt-4 text-xl leading-relaxed">COMMUTE<br />PAIN</h1>
      <p className="mt-2 text-mute">hyderabad traffic, but make it a game. no email, no drama.</p>
      <StartForm known={known} />
    </div>
  );
}
