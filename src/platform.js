export function isMobileDevice({
  userAgent = "",
  userAgentData,
  platform = "",
  maxTouchPoints = 0,
}) {
  return (
    !!userAgentData?.mobile ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}
