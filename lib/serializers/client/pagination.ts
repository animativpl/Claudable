export interface PageCursorSource {
  createdAt?: string | null;
  id?: string | null;
}

export interface PageCursor {
  createdAt: string;
  id: string;
}

// Trusts the ordering lib/services/message.ts's getMessagesByProjectId
// already guarantees for a desc-ordered batch: the last element is the
// oldest row, i.e. exactly this batch's "next page" cursor.
export const getPageCursor = (messages: PageCursorSource[]): PageCursor | null => {
  const last = messages[messages.length - 1];
  if (!last?.createdAt || !last?.id) return null;
  return { createdAt: last.createdAt, id: last.id };
};
