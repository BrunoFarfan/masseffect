// Cloudflare can prepend zone-managed crawler policy to production robots.txt.
// Verify the original suffix exactly; never ignore changes to other assets.
export function originalAssetBytes(file, bytes, environment) {
  if (file !== "robots.txt" || environment !== "production") return bytes;
  const text = bytes.toString("utf8");
  const begin = text.indexOf("# BEGIN Cloudflare Managed content");
  const marker = "# END Cloudflare Managed Content\n\n";
  const end = text.indexOf(marker);
  if (begin >= 0 && end > begin)
    return Buffer.from(text.slice(end + marker.length));
  return bytes;
}
