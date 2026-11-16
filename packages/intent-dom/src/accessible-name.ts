const WHITESPACE = /\s+/g;

const normalized = (text: string | null | undefined): string =>
  (text ?? '').replace(WHITESPACE, ' ').trim();

const labelledByName = (element: Element): string => {
  const ids = (element.getAttribute('aria-labelledby') ?? '').split(WHITESPACE).filter(Boolean);
  const texts = ids.map((id) => normalized(element.ownerDocument.getElementById(id)?.textContent));
  return texts.filter(Boolean).join(' ');
};

export const accessibleNameOf = (element: Element): string =>
  labelledByName(element) ||
  normalized(element.getAttribute('aria-label')) ||
  normalized(element.textContent);
