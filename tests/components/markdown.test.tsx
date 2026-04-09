/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Markdown } from '@/components/markdown';

describe('Markdown', () => {
  it('renders markdown tables inside a scrollable wrapper', () => {
    const markdown = [
      '| Plan | Premium |',
      '| --- | --- |',
      '| HSA | $45 |',
      '| PPO | $89 |',
    ].join('\n');

    const { container } = render(<Markdown>{markdown}</Markdown>);

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(table).toHaveClass('w-full', 'min-w-[32rem]', 'border-collapse');
    expect(container.querySelector('div.overflow-x-auto')).toBeTruthy();
    expect(screen.getByText('HSA')).toBeInTheDocument();
    expect(screen.getByText('$89')).toBeInTheDocument();
  });

  it('renders unordered lists with bullet styling', () => {
    const { container } = render(<Markdown>{'- Medical\n- Dental'}</Markdown>);

    const list = container.querySelector('ul');
    expect(list).toBeTruthy();
    expect(list).toHaveClass('list-disc');
    expect(list).not.toHaveClass('list-decimal');
  });
});
