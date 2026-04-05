/** @type {import('next').NextConfig} */

const devOrigins = ['localhost']
if (process.env.REPLIT_DEV_DOMAIN) {
  devOrigins.push(process.env.REPLIT_DEV_DOMAIN)
}
if (process.env.REPLIT_DOMAINS) {
  devOrigins.push(...process.env.REPLIT_DOMAINS.split(','))
}

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: devOrigins,
}

export default nextConfig
