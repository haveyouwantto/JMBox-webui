"""
向 resources/assets/lang/*.json 添加节拍器文案（最小 diff，不重排原有内容）。

用法: python scripts/add-metronome-locales.py
"""
import glob
import json
import os

TRANSLATIONS = {
    "en-US": ("Metronome", "Stop metronome"),
    "zh-CN": ("节拍器", "停止节拍器"),
    "zh-TW": ("節拍器", "停止節拍器"),
    "ja-JP": ("メトロノーム", "メトロノームを停止"),
    "ko": ("메트로놈", "메트로놈 정지"),
    "es": ("Metrónomo", "Detener metrónomo"),
    "fr": ("Métronome", "Arrêter le métronome"),
    "ru": ("Метроном", "Остановить метроном"),
    "ar": ("بندول الإيقاع", "إيقاف بندول الإيقاع"),
    "hi": ("मेट्रोनोम", "मेट्रोनोम बंद करें"),
    "bn": ("মেট্রোনোম", "মেট্রোনোম বন্ধ করুন"),
    "pt": ("Metrônomo", "Parar metrônomo"),
    "ur": ("میٹرونوم", "میٹرونوم روکیں"),
}


def main():
    for path in sorted(glob.glob("resources/assets/lang/*.json")):
        lang = os.path.basename(path).replace(".json", "")
        name, stop = TRANSLATIONS[lang]
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if "menu.metronome" in text:
            print("skip (already has key):", lang)
            continue
        stripped = text.rstrip()
        assert stripped.endswith("}"), path
        insert_at = stripped.rfind("}")
        head = stripped[:insert_at].rstrip()
        tail = stripped[insert_at:]
        addition = (
            ",\n    \"menu.metronome\": " + json.dumps(name, ensure_ascii=False)
            + ",\n    \"menu.metronome.stop\": " + json.dumps(stop, ensure_ascii=False)
        )
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(head + addition + "\n" + tail + "\n")
        json.load(open(path, encoding="utf-8"))  # 校验
        print("ok:", lang)


if __name__ == "__main__":
    main()
