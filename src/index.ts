import { launch, Browser, Page, devices, ElementHandle } from "puppeteer"
import { downloadFile } from "./utils"
import { writeFile, readdir } from "fs/promises"
import { basename } from "path"

const FIRST_ITEM_SELECTOR = "div#root #thumbnail_area > a"
const PHOTO_CONTAINER_SELECTOR = 'div[data-sigil="story-popup-metadata story-div feed-ufi-metadata"]'
const PHOTO_CONTENT_SELECTOR = 'div#MPhotoContent'
const ALBUM_URL = "https://m.facebook.com/media/set/?set=a.533865628109963&type=3&_rdr"

const visitedFbIds: Set<string> = new Set()

interface PhotoPageParams {
    fbid: string
}

interface TextAndHashTags {
    text: string
    hashTags: string[]
    unknownNodeNames: string[]
}

interface PhotoInfo {
    fbid: string
    text: string
    hashTags: string[]
    imgUrl: string
}

async function sleep(t: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, t);
    })
}

async function getPage(b: Browser) {
    const p = await b.newPage();
    await p.emulate(devices['iPhone 12 Pro Max'])
    return p
}

async function loadAlbumPage(p: Page): Promise<void> {
    await p.goto(ALBUM_URL)
    await p.waitForSelector(FIRST_ITEM_SELECTOR);
    await p.screenshot({
        path: "./index.png"
    })
}

async function clickFirstItem(p: Page): Promise<void> {
    await p.click(FIRST_ITEM_SELECTOR);
    await Promise.all([
        p.waitForSelector(PHOTO_CONTAINER_SELECTOR),
        p.waitForSelector(PHOTO_CONTENT_SELECTOR),
        p.waitForNetworkIdle(),
    ])

    await p.screenshot({
        path: "./clicked_first_item.png"
    })
}

async function clickNextPhoto(p: Page): Promise<void> {
    const aNodes = await p.$$('div[data-sigil~="photo-stage"] > div > a')
    let handle: ElementHandle<Element>|undefined;
    for (const h of Array.from(aNodes)) {
        const text = await h.evaluate((el) => el.textContent)
        if (text?.includes("Next")){
            handle = h
            break
        }
    }

    if (!handle) {
        throw new Error("No next found")
    }

    await handle.tap()
    await Promise.all([
        p.waitForSelector(PHOTO_CONTAINER_SELECTOR),
        p.waitForNetworkIdle(),
    ])
    await sleep(1000) // avoid FB throttle. and 500ms is too low.
}

async function getPhotoInfo(p: Page): Promise<PhotoInfo> {
    const params: PhotoPageParams = await p.evaluate(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const params = Object.fromEntries(urlParams);
        return params;
    }) as unknown as PhotoPageParams
    const [imgUrl, {text, hashTags}] = await Promise.all([
        getImage(p, params),
        getTextAndHashTags(p, params),
    ])
    console.log(imgUrl)
    console.log(text)
    console.log(hashTags)
    return {
        fbid: params.fbid,
        imgUrl, text, hashTags,
    }
}

async function savePhotoInfo({text, hashTags, fbid}: PhotoInfo) {
    const s = JSON.stringify({
        text, hashTags
    }, null, 2)
    await writeFile(`./output/${fbid}.json`, s, "utf-8")
}

/**
 * DO NOT USE. it requires login. F__K FB.
 * @param p
 * @param params
 * @returns
 */
async function getFullSizeImage(p: Page, params: PhotoPageParams): Promise<string> {
    const selector = "a[target=_blank]"
    try {
        const url = await p.$eval(selector, (a) => {
            return "https://m.facebook.com" + a.getAttribute("href")
            // const data = JSON.parse(img.getAttribute("data-store"))
            // return data.imgSrc
        })
        if (!url) {
            throw Error("url is null. FB changed implementation?")
        }
        return url
    } catch (error) {
        console.error(error)
        console.error(await p.evaluate(() => {
            return document.body.innerHTML
        }))
    }

    return ""
}

async function getImage(p: Page, params: PhotoPageParams): Promise<string> {
    const divDataStore = {object_id: parseInt(params.fbid)}

    // The selector is intended to return the `<i>` tag which show the image.
    // The image URL is store in its `data-store` attribute as part of the JSON.

    // Intended to do double stringify in order to properly quote the JSON encoded divDataStore as a string.
    const selector = "div[data-sigil~=\"photo-stage\"] img";
    console.log(selector)
    try {
        const url = await p.$eval(selector, (img) => {
            return img.getAttribute("src")
            // const data = JSON.parse(img.getAttribute("data-store"))
            // return data.imgSrc
        })
        if (!url) {
            throw Error("url is null. FB changed implementation?")
        }
        return url
    } catch (error) {
        console.error(error)
        console.error(await p.evaluate(() => {
            return document.body.innerHTML
        }))
    }

    return ""
}

async function getTextAndHashTags(p: Page, params: PhotoPageParams): Promise<TextAndHashTags> {
    try {
        const selector = "div.msg > div"
        let count = 0
        let handle = null
        do {
            handle = await p.$(selector);
            count += 1
        } while (handle === null && count < 3)

        if (handle === null) {
            throw new Error("No handle found.")
        }
        const ret = handle.evaluate((el) => {
            const tokens: string[] = []
            const hashTags: string[] = []
            const unknownNodeNames: string[] = []
            el.childNodes.forEach(e => {
                switch (e.nodeName){
                    case "A":
                        hashTags.push(e.textContent!);
                        break
                    case "SPAN":
                    case "#text":
                        tokens.push(e.textContent?.trim()!);
                        break;
                    case "BR":
                        tokens.push("\n");
                    case "WBR":
                    case "DIV":
                        // no-op
                        break
                    default:
                        console.error("Unknown nodeName", e.nodeName)
                        unknownNodeNames.push(e.nodeName)
                }
            })
            return {
                text: tokens.join("").trim(),
                hashTags,
                unknownNodeNames,
            }
        }) as unknown as TextAndHashTags
        return ret
    } catch (error) {
        console.error(error)
        console.error(await p.evaluate(() => {
            return document.body.innerHTML
        }))
        throw error
    }
}

async function main() {
    const loadedPool = new Set();
    await loadPool()
    const b = await launch();
    const p = await getPage(b);
    await loadAlbumPage(p);
    await clickFirstItem(p);
    let count = 0
    do {
        let photoInfo = await getPhotoInfo(p)
        if (visitedFbIds.has(photoInfo.fbid)) {
            break
        }

        if (loadedPool.has(photoInfo)) {
            continue
        }

        visitedFbIds.add(photoInfo.fbid)
        await downloadFile(photoInfo.imgUrl, `./output/${photoInfo.fbid}.jpg`)
        await savePhotoInfo(photoInfo)
        await clickNextPhoto(p)

        count += 1
    } while (count < 500)   // protect from buggy
    await p.close();
    await b.close();

    return

    async function loadPool() {
        const files = await readdir("./output", "utf-8")
        for (const file of files) {
            const match = /(\d+)(.json|jpg)$/.exec(file)
            if (match) {
                const fbid = match[1]
                loadedPool.add(fbid)
            }
        }
        console.log(loadedPool)
    }
}

main()