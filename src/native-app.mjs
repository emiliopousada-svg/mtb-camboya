import { App } from '@capacitor/app';

export function addBackButtonListener(listener) {
    return App.addListener('backButton', listener);
}

export function exitApp() {
    return App.exitApp();
}

export function getAppInfo() {
    return App.getInfo();
}
