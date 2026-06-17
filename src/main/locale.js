import { $ } from "./utils";
import { settings } from "./settings";
import defaultLocale from "../../resources/assets/lang/en-US.json"

let currentLocale = {};

const localeList = {
    "en-US": "English",
    "zh-CN": "\u7b80\u4f53\u4e2d\u6587",
    "zh-TW": "\u7e41\u9ad4\u4e2d\u6587",
    "ja-JP": "\u65e5\u672c\u8a9e",
    "ko": "\ud55c\uad6d\uc5b4",
    "es": "Espa\u00f1ol",
    "fr": "Fran\u00e7ais",
    "ru": "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
    "ar": "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
    "hi": "\u0939\u093f\u0928\u094d\u0926\u0940",
    "bn": "\u09ac\u09be\u0982\u09b2\u09be",
    "pt": "Portugu\u00eas",
    "ur": "\u0627\u0631\u062f\u0648"
};

export async function localeInit() {
    // 检查用户的语言设置
    let lang;

    if (settings.language == "auto") { lang = navigator.language; }
    else { lang = settings.language }

    if (lang !== 'en-US') {
        // 如果用户的语言不是英语，尝试加载对应的语言文件
        try {
            const response = await fetch(`lang/${lang}.json`);
            currentLocale = await response.json();
        } catch (err) {
            // 如果对应的语言文件加载失败，则使用默认的 en-US.json
            currentLocale = defaultLocale;
        } finally {
            updateHTML();
        }
    } else {
        // 如果用户的语言是英语，则使用默认的 en-US.json
        currentLocale = defaultLocale;
        updateHTML();
    }
}

export function getLocale(key) {
    // 先在当前语言文件中查找本地化字符串
    let value = currentLocale[key];
    if (value === undefined) {
        // 如果找不到，则在默认语言文件中查找
        value = defaultLocale[key];
        if (value === undefined) {
            // 如果还是找不到，则直接返回 key
            value = key;
        }
    }
    return value;
}

function updateHTML() {
    $("locale").forEach(element => {
        element.innerText = getLocale(element.getAttribute('key'));
    });
    $(".locale").forEach(element => {
        element.innerText = getLocale(element.getAttribute('key'));
    });
}

export function setLocale(language = 'en-US') {
    if (language == 'en-US') {
        currentLocale = defaultLocale;
        updateHTML();
    }
    else {
        fetch("lang/" + language + ".json").then(r => {
            if (r.ok) {
                r.json().then(json => {
                    currentLocale = json;
                    updateHTML();
                })
            } else {
                setLocale()
            }
        }).catch(e => {
            setLocale();
        })
    }
}

export function createLocaleItem(key) {
    let locale = document.createElement('locale');
    locale.setAttribute('key', key);
    locale.innerText = getLocale(key);
    return locale;
}

export { localeList };