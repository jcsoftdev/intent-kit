import { expect, test } from 'vitest';
import { accessibleNameOf } from './accessible-name.js';

const mount = (html: string): Element => {
  document.body.innerHTML = html;
  return document.body.querySelector('[data-subject]') as Element;
};

test.each([
  [
    'aria-labelledby wins over aria-label and text',
    '<span id="a">One</span><span id="b">Two</span><button data-subject aria-labelledby="a b" aria-label="Label">Text</button>',
    'One Two',
  ],
  [
    'aria-label wins over text',
    '<button data-subject aria-label="  Save  order ">Text</button>',
    'Save order',
  ],
  ['text content is normalized', '<button data-subject>  Save \n  order </button>', 'Save order'],
  [
    'dangling aria-labelledby falls through to aria-label',
    '<button data-subject aria-labelledby="missing" aria-label="Fallback"></button>',
    'Fallback',
  ],
  ['empty element has an empty name', '<button data-subject></button>', ''],
])('%s', (_title, html, expected) => {
  expect(accessibleNameOf(mount(html))).toBe(expected);
});
