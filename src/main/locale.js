import { $ } from "./utils";
import defaultLocale from "../../resources/assets/lang/en-US.json"

let currentLocale = {};

const localeList = {
    "en-US": "English",
    "zh-CN": "\u7b80\u4f53\u4e2d\u6587",
    "zh-TW": "\u7e41\u9ad4\u4e2d\u6587",
    "ja-JP": "\u65e5\u672c\u8a9e"
};

export async function localeInit() {
    console.log(1)
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
            }
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