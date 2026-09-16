import { redirect } from "next/navigation";

type RootPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RootPage({ searchParams }: RootPageProps) {
  const requested = await searchParams;
  const preserved = new URLSearchParams();

  for (const [key, value] of Object.entries(requested)) {
    if (Array.isArray(value)) value.forEach((entry) => preserved.append(key, entry));
    else if (typeof value === "string") preserved.set(key, value);
  }

  if (preserved.size > 0) redirect(`/market?${preserved.toString()}`);
  redirect("/scanner");
}
