import { notFound, redirect } from "next/navigation";
import { getRoute } from "@/lib/db";
import { getSession } from "@/lib/session";
import Radio from "./Radio";

export async function generateMetadata({ params }: PageProps<"/radio/[slug]">) {
  const route = await getRoute((await params).slug);
  return { title: route ? `📻 ${route.name} radio` : "Radio" };
}

export default async function RadioPage({ params }: PageProps<"/radio/[slug]">) {
  const me = await getSession();
  if (!me) redirect("/");
  const route = await getRoute((await params).slug);
  if (!route) notFound();
  return <Radio slug={route.slug} channel={route.name} ch={route.id} me={me.name} />;
}
