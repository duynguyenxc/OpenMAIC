'use client';

import Link from 'next/link';
import { GraduationCap } from 'lucide-react';

/**
 * A way back to the teaching platform from OpenMAIC's own workspace.
 *
 * The workspace is what the bare address opens, and it says nothing about
 * accounts, courses or classes. Someone handed the link — a reviewer, a new
 * instructor — lands on a chat box with "No courses yet" and has no way to
 * reach the platform short of typing /platform by hand. This renders nothing
 * on a Level 1 deployment, where there is no platform to reach.
 */
const ACCOUNTS_ENABLED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

export function PlatformLink() {
  if (!ACCOUNTS_ENABLED) return null;
  return (
    <Link
      href="/platform"
      title="Courses, students and results"
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-gray-600 transition-all hover:bg-white hover:text-gray-900 hover:shadow-sm dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
    >
      <GraduationCap className="h-4 w-4" />
      <span>Platform</span>
    </Link>
  );
}
