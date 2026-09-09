export const shouldStickToBottom = (
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold: number = 80
): boolean => {
  return scrollHeight - scrollTop - clientHeight < threshold;
};
