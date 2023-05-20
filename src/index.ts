import { launch, Browser, Page, KnownDevices, ElementHandle } from "puppeteer"
import { downloadFile } from "./utils"
import { writeFile, readdir } from "fs/promises"
import { mkdirp } from "mkdirp"

const FIRST_ITEM_SELECTOR = "div#root #thumbnail_area > a"
const PHOTO_CONTAINER_SELECTOR = 'div[data-sigil="story-popup-metadata story-div feed-ufi-metadata"]'
const PHOTO_CONTENT_SELECTOR = 'div#MPhotoContent'
const ALBUM_URL = "https://m.facebook.com/media/set/?set=a.533865628109963&type=3&_rdr"

// Directory that stores all the output files.
const OUTPUT_DIR = "./output"
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
    url: string
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
    // Dont use iphone device. FB has a pop up to open native app.
    // Find the device names here: https://github.com/hdorgeval/puppeteer-core-controller/blob/master/lib/actions/page-actions/emulate-device/device-names.ts
    await p.emulate(KnownDevices['Nexus 7'])
    return p
}

async function loadAlbumPage(p: Page): Promise<void> {
    await p.goto(ALBUM_URL)
    await p.waitForSelector(FIRST_ITEM_SELECTOR);
    await p.screenshot({
        path: "./index.png"
    })
}

async function loadPhotoPage(p: Page, photoInfo: {fbid: string, url: string}): Promise<void> {
    console.log(`Loading photo page "${photoInfo.url}".`)
    await p.goto(photoInfo.url, {
        timeout: 10_000,
    })
    // await p.screenshot({
    //     path: `./${photoInfo.fbid}_before.png`
    // })
    await Promise.all([
        p.waitForSelector(PHOTO_CONTAINER_SELECTOR),
        p.waitForSelector(PHOTO_CONTENT_SELECTOR),
        p.waitForNetworkIdle(),
    ]);
    // await p.screenshot({
    //     path: `./${photoInfo.fbid}.png`
    // })
}

/**
 * @deprecated
 * @param p
 */
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

async function getPhotoInfo(p: Page): Promise<{
    imgUrl: string, text: string, hashTags: string[]
}> {
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
        imgUrl, text, hashTags,
    }
}

async function savePhotoInfo({text, hashTags, fbid}: PhotoInfo) {
    const s = JSON.stringify({
        text, hashTags
    }, null, 2)
    await writeFile(`${OUTPUT_DIR}/${fbid}.json`, s, "utf-8")
}

/**
 * DO NOT USE. it requires login. F__K FB.
 * @deprecated
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

async function ensureOutputDir(dirname: string) {
    await mkdirp(dirname)
}

async function loadPool(output_dir: string) {
    const loadedPool = new Set();
    const files = await readdir(output_dir, "utf-8")
    // TODO: we should check both json and jpg file exist.
    for (const file of files) {
        const match = /(\d+)(.json|jpg)$/.exec(file)
        if (match) {
            const fbid = match[1]
            loadedPool.add(fbid)
        }
    }
    console.log(`${loadedPool.size} found in ${output_dir}.`)
    loadedPool.forEach((v) => {
        console.log(`"${v}"`)
    })
    return loadedPool
}

async function getAllPhotoIdsFromAlbumPage(p: Page): Promise<{fbid: string, url: string}[]> {
    await loadAlbumPage(p);
    await clickSeeMorePhotos(p);
    await sleep(1000);
    await keepScrollUntilNoMorePhotos(p, 5000);
    const miniPhotoInfo = await findAllPhotoIds(p);
    console.log(`${miniPhotoInfo.length} PhotoIDs found.`);
    console.log("Printing the first 5 info.")
    for (let i = 0 ; i < 5; i++) {
        console.log(`${i}: ${miniPhotoInfo[i].fbid}    ${miniPhotoInfo[i].url}`)
    }
    return miniPhotoInfo
}

/**
 * click the "see more photos" to trigger the infinite scroll.
 * @param p The Page that with album page opened
 */
async function clickSeeMorePhotos(p: Page){
    // TODO
    const ele = await p.$("#m_more_item > a")
    if (!ele) {
        throw new Error("Unable to find the element to trigger 'see more photos'.")
    }
    console.log("Element found for the 'see more photos'.")
    console.log(`${await countThumbnail(p)} thumbnails before clicking see more photos.`)
    await ele.click()
}

async function countThumbnail(p: Page) {
    return await p.$$eval("div#thumbnail_area > a", (elements) => elements.length)
}

/**
 * keep scolling, wait a bit, and scroll again until nothing to be added.
 * @param p the Page with album page opened
 */
async function keepScrollUntilNoMorePhotos(p: Page, waitTime: number) {
    // see https://stackoverflow.com/questions/51529332/puppeteer-scroll-down-until-you-cant-anymore
    // TODO

    let before, after;
    do {
        before = await countThumbnail(p)

        await p.$eval("div#thumbnail_area > a[data-store]:last-child", (ele) => {
            if (!ele) {
                throw new Error("Last thumbnail not found which is impossible unless there is no thumbnail at all.")
            }

            ele.scrollIntoView();
        })
        await sleep(waitTime);

        after = await countThumbnail(p)
        await p.screenshot({
            path: "./last_scroll.png"
        })
        console.log(`Before = ${before} After = ${after}.`)
    } while (before !== after)
}

/**
 *
 * @param p
 */
async function findAllPhotoIds(p: Page): Promise<{fbid: string, url: string}[]> {
    // TODO
    const n = await p.$$eval("div#thumbnail_area > a[data-store]", (aElements) => aElements.length)
    console.log(`${n} a[data-store] found.`)
    return await p.$$eval("div#thumbnail_area > a[data-store]",
        (aElements) => {
            return aElements.map(
                a => {
                    return {
                        // force it to be string.
                        fbid: "" + JSON.parse(a.getAttribute("data-store") || "{}").id,
                        url: (a as HTMLAnchorElement).href,
                    }
                }
            )
        })
}

async function main() {
    await ensureOutputDir(OUTPUT_DIR);
    const loadedPool = await loadPool(OUTPUT_DIR);

    const b = await launch({
        headless: "new",
    });
    const p = await getPage(b);
    const allPhotoInfos = await getAllPhotoIdsFromAlbumPage(p);
    for (let photoInfo of allPhotoInfos) {
        console.log(`Trying to load "${photoInfo.fbid}"`)
        if (loadedPool.has(photoInfo.fbid)) {
            console.log(`PhotoID has already loaded before ${photoInfo.fbid}.`)
            continue
        }

        await loadPhotoPage(p, photoInfo);
        const fullPhotoInfo = {
            ...photoInfo,
            ...await getPhotoInfo(p)
        }
        await downloadFile(fullPhotoInfo.imgUrl, `${OUTPUT_DIR}/${photoInfo.fbid}.jpg`)
        await savePhotoInfo(fullPhotoInfo)
        loadedPool.add(photoInfo.fbid)
        console.log("wait 500ms before fetching the next.")
        await sleep(500)
    }

    await p.close();
    await b.close();

    return
}

main()