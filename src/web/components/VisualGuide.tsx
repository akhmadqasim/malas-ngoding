import type { ReactNode } from "react";
import { Character, type CharacterRole } from "./Character.tsx";
/** One guide per task: character + a short explanation, with text kept accessible. */
export function VisualGuide({role="warga",title,children}:{role?:CharacterRole;title:string;children:ReactNode}) {
 return <div className="visual-guide"><Character role={role} variant="guide" /><div className="visual-guide__speech"><strong>{title}</strong><p>{children}</p></div></div>;
}
