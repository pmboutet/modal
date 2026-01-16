import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Brand Guidelines - Modal",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LogoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
