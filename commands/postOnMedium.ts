import fs from "fs"
import path from "path"
import fm from "front-matter"
import sharp from "sharp"

const getPostFilePath = (slug: string, fileName: string) =>
  path.resolve(__dirname, "..", "src", "posts", slug, fileName)

interface User {
  id: string
}

interface Story {
  url: string
}

interface FetchResponse<T> {
  data: T
}

interface BlogMetadata {
  title: string
  description: string
  featuredImage: string
  youTubeVideo: string
  keywords: string[]
  demo?: string
  github?: string
}

interface MediumPost {
  title: string
  tags?: string[]
  content: string
}

type PublishStatus = "public" | "draft"

interface PostOnMediumParams extends MediumPost {
  contentFormat: "markdown"
  canonicalUrl: string
  publishStatus: PublishStatus
}

const mediumAuthorizationHeader = `Bearer ${process.env.MEDIUM_INTEGRATION_TOKEN}`

interface ParsedMarkdown {
  body: string
  attributes: BlogMetadata
}

const streamToBlob = (
  stream: fs.ReadStream,
  mimeType: string
): Promise<Blob> => {
  const chunks: any[] = []

  return new Promise((resolve, reject) => {
    stream
      .on("data", (chunk: any) => chunks.push(chunk))
      .once("end", () => {
        const blob = new Blob(chunks, { type: mimeType })
        resolve(blob)
      })
      .once("error", reject)
  })
}

interface UploadImageResponse {
  url: string
}

const uploadImageToMedium = async (imagePath: string) => {
  const formData = new FormData()
  const fileStream = fs.createReadStream(imagePath)
  fileStream.pipe(sharp().jpeg())
  const blob = await streamToBlob(fileStream, "image/jpeg")
  formData.append("image", blob)

  const uploadFileResponse = await fetch("https://api.medium.com/v1/images", {
    method: "POST",
    body: formData,
    headers: {
      Authorization: mediumAuthorizationHeader,
    },
  })

  const { data }: FetchResponse<UploadImageResponse> =
    await uploadFileResponse.json()
  return data.url
}

const prepareContentForMedium = async (slug: string): Promise<MediumPost> => {
  const markdownFilePath = getPostFilePath(slug, "index.md")
  const markdown = fs.readFileSync(markdownFilePath, "utf8")
  let { body, attributes } = fm(markdown) as ParsedMarkdown
  const { featuredImage, youTubeVideo, demo, github, title, keywords } =
    attributes

  const insertions: string[] = []

  const images = body.match(/\!\[.*\]\(.*\)/g)
  await Promise.all(
    (images || []).map(async (imageToken) => {
      const imageUrl = imageToken.match(/[\(].*[^\)]/)[0].split("(")[1]
      if (imageUrl.startsWith("http")) return

      const imagePath = getPostFilePath(slug, imageUrl)

      const mediumImageUrl = await uploadImageToMedium(imagePath)
      const newImageToken = imageToken.replace(imageUrl, mediumImageUrl)
      body = body.replace(imageToken, newImageToken)
    })
  )

  if (featuredImage) {
    const mediumImageUrl = await uploadImageToMedium(
      getPostFilePath(slug, featuredImage)
    )
    insertions.push(`![](${mediumImageUrl})`)
  }

  if (youTubeVideo) {
    insertions.push(`[👋 **Watch on YouTube**](${youTubeVideo})`)
  }

  const resources: string[] = []
  if (github) {
    resources.push(`[🐙 GitHub](${github})`)
  }
  if (demo) {
    resources.push(`[🎮 Demo](${demo})`)
  }
  if (resources.length) {
    insertions.push(resources.join("  |  "))
  }

  return {
    content: [...insertions, body].join("\n\n"),
    title,
    tags: keywords,
  }
}

const getMediumUser = async () => {
  const userResponse = await fetch("https://api.medium.com/v1/me", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: mediumAuthorizationHeader,
    },
  })

  const { data }: FetchResponse<User> = await userResponse.json()

  return data
}

const postMediumStory = async (userId: string, params: PostOnMediumParams) => {
  const publishStoryRequest = await fetch(
    `https://api.medium.com/v1/users/${userId}/posts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: mediumAuthorizationHeader,
      },
      body: JSON.stringify(params),
    }
  )

  const { data }: FetchResponse<Story> = await publishStoryRequest.json()

  return data
}

const postOnMedium = async (slug: string) => {
  const mediumPost = await prepareContentForMedium(slug)

  const user = await getMediumUser()

  const { url } = await postMediumStory(user.id, {
    ...mediumPost,
    contentFormat: "markdown",
    canonicalUrl: `https://radzion.com/blog/${slug}`,
    publishStatus: "public",
  })

  console.log(url)
}

const args = process.argv.slice(2)

postOnMedium(args[0])
