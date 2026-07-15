/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "50mb" }, // large data-room uploads
  },
  // unpdf/mammoth/xlsx are server-only; keep them out of the client bundle.
  serverExternalPackages: ["unpdf", "mammoth", "xlsx"],
};
export default nextConfig;
