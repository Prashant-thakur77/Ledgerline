"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { flareTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

export const config = createConfig({
    chains: [flareTestnet],
    connectors: [injected()],
    transports: { [flareTestnet.id]: http() },
    ssr: true,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </WagmiProvider>
    );
}
