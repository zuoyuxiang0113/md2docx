import json
from pathlib import Path
from core.config_schema import DEFAULT_CONFIG


def schema(value, key=""):
    if isinstance(value, dict):
        return {"type":"object", "additionalProperties":False,"properties":{k:schema(v,k) for k,v in value.items()}}
    if isinstance(value, bool):
        return {"type":"boolean","default":value}
    if key == "updatedAt":
        return {"type":["string","null"],"maxLength":256}
    if isinstance(value, (int,float)):
        result = {"type":"number", "minimum":0, "maximum":10000, "default":value}
        if key == "schemaVersion":
            result = {"type":"integer","const":2}
        elif key == "startAt":
            result.update(type="integer",minimum=1,maximum=6)
        elif key in {"widthCm","heightCm"}:
            result.update(minimum=5,maximum=120)
        elif key == "sizePt":
            result.update(minimum=1,maximum=200)
        elif key == "lineSpacing":
            result.pop("minimum")
            result.update(exclusiveMinimum=0,maximum=10)
        return result
    result = {"type":"string", "maxLength":256, "default":value}
    enums={"preset":["A4","A5","Letter"],"orientation":["portrait","landscape"],"alignment":["left","center","right","justify"],"math":["omml","text"],"mathFallback":["warning","text"]}
    if key in enums:
        result["enum"] = enums[key]
    if key == "id":
        result["pattern"] = "^[a-z0-9][a-z0-9_-]{0,63}$"
    if key in {"color","headerColor","backgroundColor"}:
        result["pattern"] = "^#?[0-9a-fA-F]{6}$"
    return result

result = schema(DEFAULT_CONFIG)
result.update({"$schema":"https://json-schema.org/draft/2020-12/schema","title":"MD2DOCX cloud profile schemaVersion 2","required":["schemaVersion"],"description":"Missing fields inherit core defaults. Margin sums must also preserve at least 1 cm of content area; POST /v1/config/validate checks cross-field constraints."})
result["properties"]["options"]["properties"]["images"]["properties"]["alignment"]["enum"]=["left","center","right"]
Path(__file__).resolve().parents[1].joinpath("config-schema.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
