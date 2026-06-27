import React from "react";

// The Crocs brand mark (crocodile). Crocs is our security brand — the one place
// a logo/colour is allowed in the otherwise black-and-white UI.
export default function CrocsMark({ size = 18, className = "" }) {
  return (
    <img
      src="/crocodile-svgrepo-com.svg"
      alt="Crocs"
      width={size}
      height={size}
      className={`inline-block align-middle ${className}`}
      draggable={false}
    />
  );
}
