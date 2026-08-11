import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /*
     * The Hardhat project one directory up has its own lockfile, so Next infers the workspace root as the
     * repository root and warns about it. This app is self-contained — pin the root to this directory.
     */
    turbopack: { root: __dirname },
};

export default nextConfig;
