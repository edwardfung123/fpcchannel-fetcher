---
marp: true
---

<!--
paginate: true
theme: gaia
_class: lead
-->
# Using Puppeteer to download a Facebook album

---

# What is the problem?

* I follow a channel on FB.
* The author(s) posted a ton of interesting recipes on FB.
* The recipes are available on Facebook as an album. See [here](https://www.facebook.com/media/set/?vanity=FPCChannel&set=a.533865628109963)
* NONE of these platform is searchable.

---

# Why?

As a normal person, you will probably:

1. Go to the album
2. Open the first photo
3. Download the image
4. Copy and paste the description, tags, URL
5. Save them
6. Next photo

---

# Why? (cont.)

It is not super bad **IF** there are only a few photos.

## But, as of 2023-05-26, there are 385 photos to download!

---

# Automation

![width:100%](https://www.explainxkcd.com/wiki/images/f/f3/the_general_problem.png)

From [xkcd 974: The General Problem](https://xkcd.com/974/)

But why not? It is so much fun... isn't it?

---

# What tools do I need?

I need something to

1. Download a web page
2. Render the web page
   1. Downloads the CSS, JS, Images, etc in the web page
   2. Run JavaScript (everything is SPA nowadays)
   3. Render CSS quite well
3. Allow me to get the data from the web page

---

# What tools I need? (cont.)

Our **browsers** do all this amazing things for us!

But how can I program a browser? We use Mouse & Keyboard to interact with the browser!!

---

# How can I program a browser?

Modern browser supports something called "WebDriver".

> WebDriver is a remote control interface that enables introspection and control of user agents. It provides a platform- and language-neutral wire protocol as a way for out-of-process programs to remotely instruct the behavior of web browsers.

From [W3C](https://www.w3.org/TR/webdriver)

It is actually derived from the popular Selenium WebDriver browser automation framework.

---

# How can I program a browser? (cont.)

Since I have already used Selenium before, I would like to try something different this time.

[Puppeteer](https://pptr.dev/) provides a nice way to control a Chrome browser. And it is Chrome only. (Ya I am a Google fanboy.)

---

# Use the source Luke!

```
1. Pretend ourselves as a mobile browser
2. Fetch all links to the 3xx photos.
    1. Open the album page (List view)
    2. Trigger the infinite scroll (FB is fancy)
    3. Use "QuerySelector" to find all the "thumbnails" components.
    4. For each thumbnail, get the URL
3. For each URL from (2),
    1. Open the photo view
    2. Use "QuerySelector" to find the image, tags, description.
    3. Save them into files.
```

Use cache to avoid re-downloading everything

**[Ain't Nobody Got Time For That!](https://www.youtube.com/watch?v=waEC-8GFTP4&ab_channel=NobodyGotTimeForThis)**

---
<!--
class: lead
-->
Happy ~~Coding~~ Cooking!