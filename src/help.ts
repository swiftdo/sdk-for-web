import { Service } from "service";

export function urlAppendQueryParams(url: string, params: {[key: string]: any}) : string {
    const searchParams: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(Service.flatten(params))) {
        searchParams[key] = value;
    }
    // url字符串拼接参数searchParams
    let queryString = Object.keys(searchParams)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(searchParams[key])}`)
        .join("&");
    url += "?" + queryString;
    return url;
}