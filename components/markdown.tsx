import Link from 'next/link';
import React, { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { CodeBlock } from './code-block';

const components: Partial<Components> = {
  // @ts-expect-error
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
  ol: ({ node, children, className, ...props }) => {
    return (
      <ol className={cn('list-decimal list-outside ml-4 space-y-1', className)} {...props}>
        {children}
      </ol>
    );
  },
  li: ({ node, children, className, ...props }) => {
    return (
      <li className={cn('py-1', className)} {...props}>
        {children}
      </li>
    );
  },
  ul: ({ node, children, className, ...props }) => {
    return (
      <ul className={cn('list-disc list-outside ml-4 space-y-1', className)} {...props}>
        {children}
      </ul>
    );
  },
  strong: ({ node, children, ...props }) => {
    return (
      <span className="font-semibold" {...props}>
        {children}
      </span>
    );
  },
  a: ({ node, children, ...props }) => {
    return (
      // @ts-expect-error
      <Link
        className="text-blue-500 hover:underline"
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </Link>
    );
  },
  table: ({ node, children, className, ...props }) => {
    return (
      <div className="my-4 w-full overflow-x-auto rounded-lg border border-border">
        <table
          className={cn('w-full min-w-[32rem] border-collapse text-sm', className)}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  thead: ({ node, children, className, ...props }) => {
    return (
      <thead className={cn('bg-muted/60', className)} {...props}>
        {children}
      </thead>
    );
  },
  tbody: ({ node, children, className, ...props }) => {
    return (
      <tbody className={cn('divide-y divide-border', className)} {...props}>
        {children}
      </tbody>
    );
  },
  tr: ({ node, children, className, ...props }) => {
    return (
      <tr className={cn('align-top', className)} {...props}>
        {children}
      </tr>
    );
  },
  th: ({ node, children, className, ...props }) => {
    return (
      <th
        className={cn(
          'border-b border-border px-4 py-3 text-left font-semibold text-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </th>
    );
  },
  td: ({ node, children, className, ...props }) => {
    return (
      <td className={cn('px-4 py-3 text-muted-foreground', className)} {...props}>
        {children}
      </td>
    );
  },
  h1: ({ node, children, ...props }) => {
    return (
      <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
        {children}
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
        {children}
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
        {children}
      </h6>
    );
  },
};

const remarkPlugins = [remarkGfm];

const NonMemoizedMarkdown = ({ children }: { children: string }) => {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </ReactMarkdown>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);
