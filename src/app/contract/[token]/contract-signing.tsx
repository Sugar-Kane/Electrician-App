"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { SignaturePad } from "@/components/signature-pad";

/**
 * The pad on the public page, refreshing once the signature lands.
 *
 * The action already revalidates this path; the refresh is what swaps the pad
 * for the "Signed" confirmation without the customer having to reload and
 * wonder whether it worked.
 */
export function ContractSigning({ token, defaultName }: { token: string; defaultName: string }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  return <SignaturePad token={token} defaultName={defaultName} onSigned={refresh} />;
}
