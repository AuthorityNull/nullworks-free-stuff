function isDMChannel(ctx, convKey) {
  // Discord DM session keys/convKeys contain ":dm:"
  if (convKey && convKey.includes(':dm:')) return true;
  
  const sessionKey = ctx?.sessionKey || '';
  if (sessionKey.includes(':dm:')) return true;
  
  // Check channel type if available
  const channelType = ctx?.channelType;
  if (channelType === 'dm' || channelType === 'DM') return true;
  
  // Check conversationId pattern - DMs are often channel:CHANNEL_ID format
  // where channel ID for DMs is the user's DM channel
  const isDM = ctx?.metadata?.isDM || ctx?.isDM;
  if (isDM) return true;
  
  return false;
}
