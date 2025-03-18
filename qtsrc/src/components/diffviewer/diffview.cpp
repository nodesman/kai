// diffview.cpp
#include "diffview.h"
#include "diffcontentwidget.h"
#include "../../models/diffmodel.h"
#include <QPainter>
#include <QVBoxLayout>
#include <QMouseEvent>
#include <QListView>
#include <QSplitter>
#include <QWheelEvent>
#include <QScrollArea>
#include <QFontMetrics>
#include <QPalette> // Include QPalette

DiffView::DiffView(QWidget *parent)
    : QWidget(parent)
    , m_model(nullptr)
    , m_fileListView(new QListView(this))
    , m_scrollArea(new QScrollArea(this))
    , m_lineHeight(0)
{
    setFocusPolicy(Qt::StrongFocus);

    // Main Layout
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    QSplitter *splitter = new QSplitter(Qt::Vertical, this);
    mainLayout->addWidget(splitter);

    // Add file list
    splitter->addWidget(m_fileListView);

    // Scroll Area Setup
    m_scrollArea->setWidgetResizable(true);
    m_scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    m_scrollArea->setVerticalScrollBarPolicy(Qt::ScrollBarAsNeeded);

    // --- Set background color for the scroll area ---
    QPalette palette = m_scrollArea->palette();
    palette.setColor(QPalette::Window, Qt::white); // Set the *Window* role
    m_scrollArea->setPalette(palette);
    m_scrollArea->setAutoFillBackground(true); // IMPORTANT: Enable auto-fill

    splitter->addWidget(m_scrollArea);

    // Set the layout!
    setLayout(mainLayout);

    connect(m_fileListView, &QListView::clicked, this, &DiffView::onFileSelectionChanged);
}

DiffView::~DiffView() {
    // QScopedPointer handles deletion of m_diffContent
}

void DiffView::setModel(DiffModel *model) {
    m_model = model;
    if (m_fileListView) {
        m_fileListView->setModel(m_model);
    }
}

void DiffView::onFileSelectionChanged(const QModelIndex &index) {
    if (!m_model || !index.isValid()) {
        return;
    }
    QString fileName = m_model->data(index, Qt::DisplayRole).toString();

    QString fileContent = m_model->getFileContent(index.row());
    QList<DiffLine> diffData = parseDiffContent(fileContent);

    if (m_lineHeight == 0) {
        QFontMetrics fontMetrics(QFont("Courier New", 12));
        m_lineHeight = fontMetrics.height();
    }

    m_diffContent.reset(new DiffContentWidget(m_scrollArea));
    m_scrollArea->setWidget(m_diffContent.data());
    m_diffContent->setDiffData(diffData, fileName);
}

QList<DiffView::DiffLine> DiffView::parseDiffContent(const QString& content) {
    QList<DiffView::DiffLine> diffData;
    QStringList lines = content.split('\n');

    for (const QString& line : lines) {
        DiffLine diffLine;

        if (line.startsWith('+')) {
            diffLine.changeType = DiffLine::Added;
            diffLine.text = line.mid(1);
        } else if (line.startsWith('-')) {
            diffLine.changeType = DiffLine::Removed;
            diffLine.text = line.mid(1);
        } else {
            diffLine.changeType = DiffLine::Unchanged;
            diffLine.text = line;
        }

        diffData.append(diffLine);
    }

    return diffData;
}

void DiffView::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::RightButton) {
        emit requestDiffExplanation();
    }
    QWidget::mousePressEvent(event);
}