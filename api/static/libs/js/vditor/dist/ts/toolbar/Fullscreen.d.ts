/// <reference types="./types" />
import { MenuItem } from "./MenuItem";
export declare class Fullscreen extends MenuItem {
    private originalParent;
    private fullscreenWrapper;
    constructor(vditor: IVditor, menuItem: IMenuItem);
    _bindEvent(vditor: IVditor, menuItem: IMenuItem): void;
}
