
import React from "react";
import { RightDrawer } from "./RightDrawer";

export function AssetLibraryDrawer(props: {
  isOpen: boolean;
  setOpen: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  const { isOpen, setOpen, children } = props;

  return (
    <RightDrawer
      isOpen={isOpen}
      onClose={() => setOpen(false)}
      onOpen={() => setOpen(true)}
      handleLabel="ASSETS"
      widthClass="w-[90vw] md:w-[450px]"
    >
      <div className="h-full flex flex-col">
        {children}
      </div>
    </RightDrawer>
  );
}
