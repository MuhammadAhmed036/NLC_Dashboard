/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the workspace root to this project to avoid incorrect inference
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
